import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchUnprocessedBriefEmails, markEmailAsRead } from '@/lib/email/monitor'
import { extractProject, generateProjectBlocks } from '@/lib/ai/project-extractor'
import type { TextSource } from '@/lib/ai/project-extractor'
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

async function parsePdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = await import('pdf-parse')
    const fn = (pdfParse as { default?: (b: Buffer) => Promise<{ text: string }> }).default || pdfParse
    const data = await (fn as (b: Buffer) => Promise<{ text: string }>)(buffer)
    return data.text || ''
  } catch {
    return ''
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
        // Skip already processed
        const existing = await prisma.emailLog.findUnique({ where: { messageId: email.messageId } })
        if (existing?.processed) { skipped++; continue }

        // Log email (clears previous error for retry)
        await prisma.emailLog.upsert({
          where: { messageId: email.messageId },
          create: { messageId: email.messageId, subject: email.subject, from: email.from, receivedAt: email.receivedAt },
          update: { error: null },
        })

        // Fast duplicate check by messageId
        const duplicate = await prisma.project.findFirst({ where: { emailMessageId: email.messageId } })
        if (duplicate) {
          await prisma.emailLog.update({ where: { messageId: email.messageId }, data: { processed: true, projectId: duplicate.id } })
          skipped++
          continue
        }

        // ── Build text sources: PDFs + full thread text ─────────────────────
        const sources: TextSource[] = []

        for (const att of email.pdfAttachments ?? []) {
          const text = await parsePdfText(att.buffer)
          if (text.trim().length > 30) sources.push({ filename: att.filename, text })
        }

        // Use full thread text (all messages in chain) as body source
        const threadText = email.threadText?.trim() ?? email.bodyText?.trim() ?? ''
        if (threadText.length > 50) {
          sources.push({ filename: 'email-thread.txt', text: threadText, isBody: true })
        }

        if (sources.length === 0) {
          await prisma.emailLog.update({
            where: { messageId: email.messageId },
            data: { error: 'No parseable content found' },
          })
          continue
        }

        // Combined text for AI (PDFs + thread)
        const combinedRaw = [
          threadText ? `=== CADENA DE EMAIL (${email.threadMessageCount} mensajes) ===\n${threadText}` : '',
          ...sources.filter((s) => !s.isBody).map((s) => `=== ADJUNTO: ${s.filename} ===\n${s.text}`),
        ].filter(Boolean).join('\n\n')

        // ── Extract project + campaign + blocks (all concurrently) ───────────
        const [extracted, briefBlocks] = await Promise.all([
          extractProject(sources, email.subject, email.from),
          generateProjectBlocks(combinedRaw, email.subject),
        ])

        // Duplicate check by name + city
        if (extracted.projectName && extracted.city) {
          const nameDup = await prisma.project.findFirst({
            where: { name: extracted.projectName, city: extracted.city },
          })
          if (nameDup) {
            const shouldUpdate = combinedRaw.length > (nameDup.briefRawText?.length ?? 0)
            if (shouldUpdate) {
              await prisma.project.update({
                where: { id: nameDup.id },
                data: {
                  briefRawText: combinedRaw,
                  briefData: JSON.stringify(extracted.campaign),
                  briefBlocks: briefBlocks ? JSON.stringify(briefBlocks) : undefined,
                  briefParsedAt: new Date(),
                  emailThreadId: email.threadId,
                  emailMessageId: email.messageId,
                  emailReceivedAt: email.receivedAt,
                },
              })
            }
            await prisma.emailLog.update({ where: { messageId: email.messageId }, data: { processed: true, projectId: nameDup.id } })
            skipped++
            continue
          }
        }

        // ── Create project ───────────────────────────────────────────────────
        const project = await prisma.project.create({
          data: {
            name: extracted.projectName,
            macroProject: extracted.macroProject,
            city: extracted.city,
            type: extracted.type,
            stage: extracted.stage,
            status: extracted.confidence === 'low' ? 'needs_review' : 'active',
            monthYear: extracted.monthYear,
            briefFileName: email.pdfAttachments?.[0]?.filename ?? email.attachmentName ?? '',
            briefParsedAt: new Date(),
            briefRawText: combinedRaw,
            briefData: JSON.stringify(extracted.campaign),
            briefBlocks: briefBlocks ? JSON.stringify(briefBlocks) : undefined,
            parseSource: extracted.parseSource,
            parseConfidence: extracted.confidence,
            needsReview: extracted.confidence === 'low',
            emailSubject: email.subject,
            emailReceivedAt: email.receivedAt,
            emailMessageId: email.messageId,
            emailThreadId: email.threadId,
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

        // Jira structures
        const jira = generateJiraStructuresForProject(toProjectDTO(project))
        if (jira.length > 0) {
          await prisma.jiraStructure.createMany({
            data: jira.map((j) => ({ epic: j.epic, task: j.task, subtask: j.subtask, month: j.month, type: j.type, projectId: project.id })),
          })
        }

        // Google Sheet
        if (config.googleDrive?.clientEmail && config.googleDrive?.privateKey) {
          try {
            const { createAmiloClientSheet } = await import('@/lib/sheets/google-sheets')
            const sheet = await createAmiloClientSheet(config.googleDrive, config.googleDrive.folderId || '', toProjectDTO(project))
            await prisma.project.update({ where: { id: project.id }, data: { googleSheetId: sheet.spreadsheetId, googleSheetUrl: sheet.url } })
          } catch (sheetErr) {
            console.error('Sheet creation error:', sheetErr)
          }
        }

        await prisma.emailLog.update({ where: { messageId: email.messageId }, data: { processed: true, projectId: project.id } })
        await markEmailAsRead(gmailCreds, email.messageId)
        processed++

        console.log(`✓ "${project.name}" (${project.city}) [${extracted.parseSource}/${extracted.confidence}] — ${sources.length} fuente(s), ${extracted.campaign.channels.length} canales`)

      } catch (emailErr) {
        const msg = String(emailErr).slice(0, 500)
        console.error(`Error processing ${email.messageId}:`, emailErr)
        errors.push(`${email.subject}: ${msg}`)
        await prisma.emailLog.update({ where: { messageId: email.messageId }, data: { error: msg } }).catch(() => {})
      }
    }

    return NextResponse.json({ message: 'OK', processed, skipped, total: emails.length, ...(errors.length ? { errors } : {}) })
  } catch (error) {
    const msg = String(error)
    console.error('Cron error:', error)
    if (msg.includes('invalid_grant')) return NextResponse.json({ error: msg, needsReauth: true }, { status: 401 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
