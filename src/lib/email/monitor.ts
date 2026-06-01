import { google } from 'googleapis'
import { parseBriefText, parseFilename } from '@/lib/brief/parser'
import type { ParsedBrief } from '@/types'

// Subject patterns to match
const SUBJECT_PATTERNS = [
  /^AMARILO\s*\|/i,
  /^Amarilo\s*\|/i,
]

export interface EmailBrief {
  messageId: string
  subject: string
  from: string
  receivedAt: Date
  attachmentName?: string
  pdfBuffer?: Buffer
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
    'https://developers.google.com/oauthplayground'
  )
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken })
  return google.gmail({ version: 'v1', auth: oauth2Client })
}

export async function fetchUnprocessedBriefEmails(credentials: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<EmailBrief[]> {
  const gmail = createGmailClient(credentials)
  const results: EmailBrief[] = []

  // Search for unread emails matching Amarilo pattern
  const query = 'is:unread subject:"Amarilo" has:attachment'

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 20,
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
    const subject = headers.find((h) => h.name === 'Subject')?.value || ''
    const from = headers.find((h) => h.name === 'From')?.value || ''
    const dateStr = headers.find((h) => h.name === 'Date')?.value || ''

    // Check if subject matches pattern
    const isAmarilo = SUBJECT_PATTERNS.some((p) => p.test(subject))
    if (!isAmarilo) continue

    const receivedAt = new Date(dateStr)

    // Find PDF attachment
    const parts = full.data.payload?.parts || []
    let attachmentName = ''
    let pdfBuffer: Buffer | undefined

    for (const part of parts) {
      if (part.mimeType === 'application/pdf' || part.filename?.endsWith('.pdf')) {
        attachmentName = part.filename || ''

        if (part.body?.attachmentId) {
          const attachRes = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: msg.id,
            id: part.body.attachmentId,
          })
          if (attachRes.data.data) {
            const base64 = attachRes.data.data.replace(/-/g, '+').replace(/_/g, '/')
            pdfBuffer = Buffer.from(base64, 'base64')
          }
        }
        break
      }
    }

    results.push({
      messageId: msg.id,
      subject,
      from,
      receivedAt,
      attachmentName,
      pdfBuffer,
    })
  }

  return results
}

export async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  // Dynamic import to avoid SSR issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse: any = (await import('pdf-parse'))
  const fn = pdfParse.default || pdfParse
  const data = await fn(buffer)
  return data.text
}

export async function processEmailBrief(email: EmailBrief): Promise<ParsedBrief | null> {
  if (!email.pdfBuffer || !email.attachmentName) return null

  try {
    const text = await parsePdfBuffer(email.pdfBuffer)
    const brief = parseBriefText(text, email.attachmentName, email.subject)
    return brief
  } catch (err) {
    console.error('Error parsing PDF:', err)
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
