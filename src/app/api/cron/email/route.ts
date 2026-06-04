import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchUnprocessedBriefEmails, processEmailBrief, markEmailAsRead } from '@/lib/email/monitor'
import { generateJiraStructuresForProject } from '@/lib/jira/generator'
import type { Project, TorreData } from '@/types'

type PrismaProject = Awaited<ReturnType<typeof prisma.project.findUniqueOrThrow>> & {
  torres: Awaited<ReturnType<typeof prisma.torre.findMany>>
}

function toProjectDTO(p: PrismaProject): Project & { torres: TorreData[] } {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    briefParsedAt: p.briefParsedAt?.toISOString(),
    emailReceivedAt: p.emailReceivedAt?.toISOString(),
    stage: p.stage as 'EXPECTATIVA' | 'LANZAMIENTO' | 'SOSTENIMIENTO',
    type: p.type as 'VIS' | 'NO VIS' | 'TOPE VIS' | 'VIP' | 'VIS DE RENOVACION URBANA' | 'LUXURY',
    torres: p.torres.map((t) => ({
      id: t.id,
      name: t.name,
      areas: JSON.parse(t.areas) as string[],
      leadGoal: t.leadGoal,
      budget: t.budget,
      motivo: t.motivo,
      ageRange: t.ageRange,
    })),
  }
}

export const maxDuration = 60

export async function GET(req: Request) {
  // Verify cron secret to protect this endpoint
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Load Gmail credentials from settings
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    if (!settings) {
      return NextResponse.json({ message: 'No settings configured', processed: 0 })
    }

    const config = JSON.parse(settings.data)
    const gmailCreds = config.gmail

    if (!gmailCreds?.clientId || !gmailCreds?.refreshToken) {
      return NextResponse.json({ message: 'Gmail not configured', processed: 0 })
    }

    // Fetch unprocessed emails
    const emails = await fetchUnprocessedBriefEmails(gmailCreds)
    let processed = 0

    for (const email of emails) {
      // Skip already logged
      const existing = await prisma.emailLog.findUnique({ where: { messageId: email.messageId } })
      if (existing?.processed) continue

      // Log the email
      await prisma.emailLog.upsert({
        where: { messageId: email.messageId },
        create: {
          messageId: email.messageId,
          subject: email.subject,
          from: email.from,
          receivedAt: email.receivedAt,
        },
        update: {},
      })

      // Parse brief
      const parseResult = await processEmailBrief(email)
      if (!parseResult) {
        await prisma.emailLog.update({
          where: { messageId: email.messageId },
          data: { error: 'No parseable content (no PDF and no body text)' },
        })
        continue
      }

      const { brief, rawText } = parseResult

      // Skip if another project already has this email message ID
      const duplicate = await prisma.project.findFirst({
        where: { emailMessageId: email.messageId },
      })
      if (duplicate) {
        await prisma.emailLog.update({
          where: { messageId: email.messageId },
          data: { processed: true, projectId: duplicate.id },
        })
        continue
      }

      // Create project — save rawText so IA analysis and search work later
      const project = await prisma.project.create({
        data: {
          name: brief.projectName || email.subject,
          macroProject: brief.macroProject || brief.projectName || email.subject,
          city: brief.city || '',
          type: brief.type,
          stage: brief.stage,
          monthYear: brief.monthYear,
          briefFileName: email.attachmentName || '',
          briefParsedAt: new Date(),
          briefRawText: rawText,
          emailSubject: email.subject,
          emailReceivedAt: email.receivedAt,
          emailMessageId: email.messageId,
          torres: {
            create: brief.torres.map((t) => ({
              name: t.name,
              areas: JSON.stringify(t.areas || []),
              leadGoal: t.leadGoal || 0,
              budget: t.budget || 0,
              motivo: t.motivo,
              ageRange: t.ageRange,
              audience: t.audience ? JSON.stringify(t.audience) : null,
            })),
          },
        },
        include: { torres: true },
      })

      // Generate Jira structures
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jiraStructures = generateJiraStructuresForProject(toProjectDTO(project))

      await prisma.jiraStructure.createMany({
        data: jiraStructures.map((j) => ({
          epic: j.epic,
          task: j.task,
          subtask: j.subtask,
          month: j.month,
          type: j.type,
          projectId: project.id,
        })),
      })

      // Create Google Sheet if configured
      if (config.googleDrive?.clientEmail && config.googleDrive?.privateKey) {
        try {
          const { createAmiloClientSheet } = await import('@/lib/sheets/google-sheets')
          const sheet = await createAmiloClientSheet(
            config.googleDrive,
            config.googleDrive.folderId || '',
            toProjectDTO(project)
          )

          await prisma.project.update({
            where: { id: project.id },
            data: { googleSheetId: sheet.spreadsheetId, googleSheetUrl: sheet.url },
          })
        } catch (sheetErr) {
          console.error('Error creating Google Sheet:', sheetErr)
        }
      }

      // Mark email as processed
      await prisma.emailLog.update({
        where: { messageId: email.messageId },
        data: { processed: true, projectId: project.id },
      })

      await markEmailAsRead(gmailCreds, email.messageId)
      processed++
    }

    return NextResponse.json({ message: 'OK', processed, total: emails.length })
  } catch (error) {
    console.error('Cron email error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
