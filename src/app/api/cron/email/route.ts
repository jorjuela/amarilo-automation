import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchUnprocessedBriefEmails, markEmailAsRead } from '@/lib/email/monitor'
import { extractProject } from '@/lib/ai/project-extractor'
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

export const maxDuration = 120

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    if (!settings) return NextResponse.json({ message: 'No settings configured', processed: 0 })

    const config = JSON.parse(settings.data)
    const gmailCreds = config.gmail

    if (!gmailCreds?.clientId || !gmailCreds?.refreshToken) {
      return NextResponse.json({ message: 'Gmail not configured', processed: 0 })
    }

    const emails = await fetchUnprocessedBriefEmails(gmailCreds)
    let processed = 0
    let skipped = 0
    const errors: string[] = []

    for (const email of emails) {
      try {
        // Check if already fully processed
        const existing = await prisma.emailLog.findUnique({ where: { messageId: email.messageId } })
        if (existing?.processed) { skipped++; continue }

        // Log the email (upsert clears previous error so we can retry)
        await prisma.emailLog.upsert({
          where: { messageId: email.messageId },
          create: {
            messageId: email.messageId,
            subject: email.subject,
            from: email.from,
            receivedAt: email.receivedAt,
          },
          update: { error: null }, // clear previous error on retry
        })

        // Check duplicate by emailMessageId OR by name+city (same project sent again)
        const duplicate = await prisma.project.findFirst({
          where: {
            OR: [
              { emailMessageId: email.messageId },
              // We'll check name+city after extraction
            ],
          },
        })
        if (duplicate) {
          await prisma.emailLog.update({
            where: { messageId: email.messageId },
            data: { processed: true, projectId: duplicate.id },
          })
          skipped++
          continue
        }

        // Build raw text: prefer PDF, fall back to body
        let rawText = ''
        if (email.pdfBuffer) {
          try {
            const pdfParse = await import('pdf-parse')
            const fn = (pdfParse as { default?: (b: Buffer) => Promise<{ text: string }> }).default || pdfParse
            const data = await (fn as (b: Buffer) => Promise<{ text: string }>)(email.pdfBuffer)
            rawText = data.text
          } catch (pdfErr) {
            console.error('PDF parse error:', pdfErr)
          }
        }
        if (rawText.trim().length < 100 && email.bodyText && email.bodyText.trim().length > 50) {
          rawText = email.bodyText
        }

        // Extract project info using AI → Regex → Subject fallback chain
        const extracted = await extractProject(
          rawText,
          email.attachmentName || '',
          email.subject,
          email.from,
        )

        // Check duplicate by name+city now that we have it
        if (extracted.projectName && extracted.city) {
          const nameDuplicate = await prisma.project.findFirst({
            where: {
              name: extracted.projectName,
              city: extracted.city,
            },
          })
          if (nameDuplicate) {
            // Update existing project with newer email info if needed
            await prisma.project.update({
              where: { id: nameDuplicate.id },
              data: {
                emailMessageId: email.messageId,
                emailReceivedAt: email.receivedAt,
                ...(rawText && rawText.length > (nameDuplicate.briefRawText?.length ?? 0)
                  ? { briefRawText: rawText, briefParsedAt: new Date() }
                  : {}),
              },
            })
            await prisma.emailLog.update({
              where: { messageId: email.messageId },
              data: { processed: true, projectId: nameDuplicate.id },
            })
            skipped++
            continue
          }
        }

        // Create project with all extracted info
        const project = await prisma.project.create({
          data: {
            name: extracted.projectName,
            macroProject: extracted.macroProject,
            city: extracted.city,
            type: extracted.type,
            stage: extracted.stage,
            status: extracted.confidence === 'low' ? 'needs_review' : 'active',
            monthYear: extracted.monthYear,
            briefFileName: email.attachmentName || '',
            briefParsedAt: new Date(),
            briefRawText: rawText,
            parseSource: extracted.parseSource,
            parseConfidence: extracted.confidence,
            needsReview: extracted.confidence === 'low',
            emailSubject: email.subject,
            emailReceivedAt: email.receivedAt,
            emailMessageId: email.messageId,
            torres: {
              create: extracted.torres.map((t) => ({
                name: t.name,
                areas: JSON.stringify(t.areas || []),
                leadGoal: t.leadGoal || 0,
                budget: t.budget || 0,
                motivo: t.motivo ?? null,
                ageRange: t.ageRange ?? null,
                audience: t.audience ? JSON.stringify(t.audience) : null,
              })),
            },
          },
          include: { torres: true },
        })

        // Generate Jira structures
        const jiraStructures = generateJiraStructuresForProject(toProjectDTO(project))
        if (jiraStructures.length > 0) {
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
        }

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
            // Non-fatal — project was still created
          }
        }

        // Mark email as processed
        await prisma.emailLog.update({
          where: { messageId: email.messageId },
          data: { processed: true, projectId: project.id },
        })

        await markEmailAsRead(gmailCreds, email.messageId)
        processed++

        console.log(`✓ Created project "${project.name}" (${project.city}) from email "${email.subject}" [${extracted.parseSource}, confidence=${extracted.confidence}]`)

      } catch (emailErr) {
        const errMsg = String(emailErr)
        console.error(`Error processing email ${email.messageId}:`, emailErr)
        errors.push(`${email.subject}: ${errMsg.slice(0, 200)}`)
        await prisma.emailLog.update({
          where: { messageId: email.messageId },
          data: { error: errMsg.slice(0, 500) },
        }).catch(() => {})
      }
    }

    return NextResponse.json({
      message: 'OK',
      processed,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      total: emails.length,
    })
  } catch (error) {
    console.error('Cron email error:', error)
    const errMsg = String(error)
    if (errMsg.includes('invalid_grant')) {
      return NextResponse.json({ error: errMsg, needsReauth: true }, { status: 401 })
    }
    return NextResponse.json({ error: errMsg }, { status: 500 })
  }
}
