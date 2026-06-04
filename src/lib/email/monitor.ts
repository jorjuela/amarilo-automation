import { google } from 'googleapis'
import { parseBriefText, parseFilename } from '@/lib/brief/parser'
import type { ParsedBrief } from '@/types'

// Subject patterns — not anchored to start, handles RE:/FWD:/Fwd: prefixes
const SUBJECT_PATTERNS = [
  /AMARILO\s*\|/i,
  /AMARILO\s+PROYECTOS/i,
  /BRIEF.*AMARILO/i,
  /AMARILO.*BRIEF/i,
]

export interface EmailBrief {
  messageId: string
  subject: string
  from: string
  receivedAt: Date
  attachmentName?: string
  pdfBuffer?: Buffer
  bodyText?: string   // plain-text body
  bodyHtml?: string   // HTML body
  parsedBrief?: ParsedBrief
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

// Recursively walk MIME parts to find attachments and body text
function walkParts(
  parts: { mimeType?: string | null; filename?: string | null; body?: { attachmentId?: string | null; data?: string | null } | null; parts?: unknown[] | null }[],
  result: { pdf: { filename: string; attachmentId: string } | null; textPlain: string; textHtml: string }
) {
  for (const part of parts) {
    const mime = part.mimeType || ''
    const filename = part.filename || ''
    const data = part.body?.data || ''
    const attachmentId = part.body?.attachmentId || ''

    if (mime === 'text/plain' && !filename && data) {
      const decoded = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
      result.textPlain += decoded
    } else if (mime === 'text/html' && !filename && data) {
      const decoded = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
      result.textHtml += decoded
    } else if ((mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) && attachmentId && !result.pdf) {
      result.pdf = { filename, attachmentId }
    } else if (mime.startsWith('multipart/') && Array.isArray(part.parts)) {
      walkParts(part.parts as typeof parts, result)
    }
  }
}

export async function fetchUnprocessedBriefEmails(credentials: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<EmailBrief[]> {
  const gmail = createGmailClient(credentials)
  const results: EmailBrief[] = []

  // Broader query: don't restrict to unread, search last 30 days with Amarilo in subject
  // Using OR so we catch both uppercase and mixed-case
  const query = '(subject:AMARILO OR subject:Amarilo) newer_than:30d'

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  })

  const messages = listRes.data.messages || []

  for (const msg of messages) {
    if (!msg.id) continue

    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    })

    const headers = full.data.payload?.headers || []
    const subject  = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || ''
    const from     = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || ''
    const dateStr  = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || ''

    // Flexible subject match
    const isAmarilo = SUBJECT_PATTERNS.some((p) => p.test(subject))
    if (!isAmarilo) continue

    const receivedAt = dateStr ? new Date(dateStr) : new Date()

    // Walk all MIME parts recursively
    const allParts: Parameters<typeof walkParts>[0] = []
    if (full.data.payload?.parts) {
      allParts.push(...(full.data.payload.parts as Parameters<typeof walkParts>[0]))
    }
    // Also handle single-part messages (body directly on payload)
    if (full.data.payload?.body?.data && !full.data.payload.parts?.length) {
      const payloadMime = full.data.payload.mimeType || ''
      const payloadData = full.data.payload.body.data
      allParts.push({ mimeType: payloadMime, body: { data: payloadData }, filename: '' })
    }

    const found = { pdf: null as { filename: string; attachmentId: string } | null, textPlain: '', textHtml: '' }
    walkParts(allParts, found)

    // Download PDF if found
    let pdfBuffer: Buffer | undefined
    let attachmentName = ''
    if (found.pdf) {
      attachmentName = found.pdf.filename
      try {
        const attachRes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: msg.id,
          id: found.pdf.attachmentId,
        })
        if (attachRes.data.data) {
          const base64 = attachRes.data.data.replace(/-/g, '+').replace(/_/g, '/')
          pdfBuffer = Buffer.from(base64, 'base64')
        }
      } catch (err) {
        console.error(`Error downloading attachment for ${msg.id}:`, err)
      }
    }

    // Strip HTML tags for body text fallback
    const bodyText = found.textPlain || stripHtml(found.textHtml)

    results.push({
      messageId: msg.id,
      subject,
      from,
      receivedAt,
      attachmentName,
      pdfBuffer,
      bodyText,
      bodyHtml: found.textHtml,
    })
  }

  return results
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

export async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse: any = (await import('pdf-parse'))
  const fn = pdfParse.default || pdfParse
  const data = await fn(buffer)
  return data.text
}

export async function processEmailBrief(email: EmailBrief): Promise<{ brief: ParsedBrief; rawText: string } | null> {
  // Prefer PDF attachment, fall back to email body text
  let rawText = ''

  if (email.pdfBuffer && email.attachmentName) {
    try {
      rawText = await parsePdfBuffer(email.pdfBuffer)
    } catch (err) {
      console.error('PDF parse error:', err)
    }
  }

  // If PDF parsing yielded nothing, use email body
  if (rawText.trim().length < 100 && email.bodyText && email.bodyText.trim().length > 50) {
    rawText = email.bodyText
  }

  if (!rawText.trim()) return null

  try {
    const filename = email.attachmentName || `email-${email.messageId}.txt`
    const brief = parseBriefText(rawText, filename, email.subject)
    return { brief, rawText }
  } catch (err) {
    console.error('Brief parse error:', err)
    return null
  }
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
