import { google } from 'googleapis'

const SUBJECT_PATTERNS = [
  /AMARILO\s*\|/i,
  /AMARILO\s+PROYECTOS/i,
  /BRIEF.*AMARILO/i,
  /AMARILO.*BRIEF/i,
]

export interface PdfAttachment {
  filename: string
  buffer: Buffer
}

export interface EmailBrief {
  /** Thread ID — used for deduplication (covers entire email chain) */
  messageId: string
  threadId: string
  subject: string
  from: string
  receivedAt: Date
  pdfAttachments: PdfAttachment[]
  bodyText?: string
  bodyHtml?: string
  /** Plain text body of every message in the thread concatenated */
  threadText?: string
  /** Number of messages in the thread */
  threadMessageCount: number
  attachmentName?: string
  pdfBuffer?: Buffer
}

export function createGmailClient(credentials: {
  clientId: string
  clientSecret: string
  refreshToken: string
}) {
  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/gmail/callback`
      : 'https://developers.google.com/oauthplayground'
  )
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken })
  return google.gmail({ version: 'v1', auth: oauth2Client })
}

type MimePart = {
  mimeType?: string | null
  filename?: string | null
  body?: { attachmentId?: string | null; data?: string | null } | null
  parts?: unknown[] | null
}

type WalkResult = {
  pdfs: { filename: string; attachmentId: string }[]
  textPlain: string
  textHtml: string
}

function walkParts(parts: MimePart[], result: WalkResult) {
  for (const part of parts) {
    const mime         = part.mimeType || ''
    const filename     = part.filename || ''
    const data         = part.body?.data || ''
    const attachmentId = part.body?.attachmentId || ''

    if (mime === 'text/plain' && !filename && data) {
      result.textPlain += Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    } else if (mime === 'text/html' && !filename && data) {
      result.textHtml += Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    } else if ((mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) && attachmentId) {
      result.pdfs.push({ filename, attachmentId })
    } else if (mime.startsWith('multipart/') && Array.isArray(part.parts)) {
      walkParts(part.parts as MimePart[], result)
    }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ─── Main: fetch threads (entire email chains) ────────────────────────────────

export async function fetchUnprocessedBriefEmails(credentials: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<EmailBrief[]> {
  const gmail   = createGmailClient(credentials)
  const results: EmailBrief[] = []

  // Find threads (not individual messages) containing AMARILO in subject
  const threadListRes = await gmail.users.threads.list({
    userId: 'me',
    q: '(subject:AMARILO OR subject:Amarilo) newer_than:30d',
    maxResults: 30,
  })

  const threads = threadListRes.data.threads || []

  for (const thread of threads) {
    if (!thread.id) continue

    // Fetch the FULL thread — all messages in the chain
    const threadData = await gmail.users.threads.get({
      userId: 'me',
      id: thread.id,
      format: 'full',
    })

    const messages = threadData.data.messages || []
    if (messages.length === 0) continue

    // Use the FIRST message in the thread for subject / from / date
    const firstMsg = messages[0]
    const firstHeaders = firstMsg.payload?.headers || []
    const subject = firstHeaders.find((h) => h.name?.toLowerCase() === 'subject')?.value || ''
    const from    = firstHeaders.find((h) => h.name?.toLowerCase() === 'from')?.value || ''
    const dateStr = firstHeaders.find((h) => h.name?.toLowerCase() === 'date')?.value || ''

    if (!SUBJECT_PATTERNS.some((p) => p.test(subject))) continue

    const receivedAt = dateStr ? new Date(dateStr) : new Date()

    // Collect text and PDFs from EVERY message in the thread
    const allPdfs: { filename: string; attachmentId: string; messageId: string }[] = []
    const textParts: string[] = []

    for (const msg of messages) {
      if (!msg.id || !msg.payload) continue

      const msgHeaders = msg.payload.headers || []
      const msgFrom    = msgHeaders.find((h) => h.name?.toLowerCase() === 'from')?.value || ''
      const msgDate    = msgHeaders.find((h) => h.name?.toLowerCase() === 'date')?.value || ''

      const parts: MimePart[] = []
      if (msg.payload.parts) {
        parts.push(...(msg.payload.parts as MimePart[]))
      }
      // Single-part payload
      if (msg.payload.body?.data && !msg.payload.parts?.length) {
        parts.push({ mimeType: msg.payload.mimeType || 'text/plain', body: { data: msg.payload.body.data }, filename: '' })
      }

      const found: WalkResult = { pdfs: [], textPlain: '', textHtml: '' }
      walkParts(parts, found)

      const msgText = found.textPlain || stripHtml(found.textHtml)
      if (msgText.trim()) {
        // Label each message block with sender + date for chain context
        textParts.push(`--- Mensaje de: ${msgFrom} · ${msgDate} ---\n${msgText}`)
      }

      for (const pdf of found.pdfs) {
        allPdfs.push({ ...pdf, messageId: msg.id })
      }
    }

    // Download ALL PDF attachments from across the thread
    const pdfAttachments: PdfAttachment[] = []
    for (const pdf of allPdfs) {
      try {
        const attachRes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: pdf.messageId,
          id: pdf.attachmentId,
        })
        if (attachRes.data.data) {
          pdfAttachments.push({
            filename: pdf.filename,
            buffer: Buffer.from(attachRes.data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
          })
        }
      } catch (err) {
        console.error(`Error downloading ${pdf.filename}:`, err)
      }
    }

    const threadText = textParts.join('\n\n')
    const bodyText   = textParts[0] || ''  // first message body

    // Use thread ID as the dedup key (messageId field)
    // This ensures we don't re-process the same thread
    results.push({
      messageId: thread.id,   // thread ID used as primary dedup key
      threadId: thread.id,
      subject,
      from,
      receivedAt,
      pdfAttachments,
      bodyText,
      bodyHtml: '',
      threadText,
      threadMessageCount: messages.length,
      attachmentName: pdfAttachments[0]?.filename,
      pdfBuffer: pdfAttachments[0]?.buffer,
    })
  }

  return results
}

export async function markEmailAsRead(
  credentials: { clientId: string; clientSecret: string; refreshToken: string },
  messageId: string
) {
  const gmail = createGmailClient(credentials)
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  })
}
