import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/auth'
import { createGmailClient } from '@/lib/email/monitor'

// Diagnostic endpoint: lists matching emails without processing them
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    if (!settings) return NextResponse.json({ error: 'No settings configured' }, { status: 400 })

    const config = JSON.parse(settings.data)
    const gmailCreds = config.gmail

    if (!gmailCreds?.clientId || !gmailCreds?.refreshToken) {
      return NextResponse.json({ error: 'Gmail not configured' }, { status: 400 })
    }

    const gmail = createGmailClient(gmailCreds)

    // Run multiple queries to catch all possible variants
    const queries = [
      '(subject:AMARILO OR subject:Amarilo) newer_than:30d',
      'subject:AMARILO newer_than:60d',
      'subject:Amarilo newer_than:60d',
    ]

    const allMessageIds = new Set<string>()
    for (const q of queries) {
      const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 50 })
      for (const m of res.data.messages || []) {
        if (m.id) allMessageIds.add(m.id)
      }
    }

    const diagnostics = []
    const SUBJECT_PATTERNS = [/AMARILO\s*\|/i, /AMARILO\s+PROYECTOS/i, /BRIEF.*AMARILO/i, /AMARILO.*BRIEF/i]

    for (const msgId of allMessageIds) {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      })

      const headers  = full.data.payload?.headers || []
      const subject  = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '(sin asunto)'
      const from     = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || ''
      const dateStr  = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || ''
      const labels   = full.data.labelIds || []
      const isUnread = labels.includes('UNREAD')

      const patternMatch = SUBJECT_PATTERNS.some((p) => p.test(subject))

      // Check if already in EmailLog
      const inLog = await prisma.emailLog.findUnique({ where: { messageId: msgId } })

      // Check if has attachment (snippet check)
      const hasAttachment = (full.data.payload?.parts?.length ?? 0) > 0

      diagnostics.push({
        messageId: msgId,
        subject,
        from,
        date: dateStr,
        isUnread,
        hasAttachment,
        patternMatch,
        alreadyInLog: !!inLog,
        alreadyProcessed: inLog?.processed ?? false,
        logError: inLog?.error ?? null,
        willProcess: patternMatch && !inLog?.processed,
      })
    }

    diagnostics.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return NextResponse.json({
      total: diagnostics.length,
      willProcess: diagnostics.filter((d) => d.willProcess).length,
      alreadyProcessed: diagnostics.filter((d) => d.alreadyProcessed).length,
      patternMismatch: diagnostics.filter((d) => !d.patternMatch).length,
      emails: diagnostics,
    })
  } catch (error) {
    console.error('Debug error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
