import { google } from 'googleapis'
import type { EmailTimelineItem, FinanceInfo } from '@/types'

const MAILSUITE_FILTER = /mailsuite/i
const CONTRACT_SUBJECT_PATTERN = /[\[【]?合約審閱[\]】]?/
const CONTRACT_LIKE_PATTERN = /合約審閱|合約|契約|用印|NDA|保密|contract|agreement/i
const GR_NUMBER_PATTERN = /GR[\s\-]?\d{3,8}/i   // 允許 GR001164 / GR-001164 / GR 001164
const INVOICE_SUBJECT = /Thanks for filling out this form: Garena 發票開立申請單/

const LEGAL_TEAM = [
  'lindai@garena.com', 'lindai@sea.com',
  'tsengw@garena.com', 'tsengw@sea.com',
  'land@garena.com',   'land@sea.com',
]
const FINANCE_TEAM = ['wuc@sea.com', 'linr@sea.com', 'lui@sea.com']
const BD_TEAM = ['liny@garena.com', 'chenla@garena.com']

export interface GmailThread {
  threadId: string
  grNumber: string
  subject: string
  messages: GmailMessage[]
}

export interface GmailAttachment {
  filename: string
  mimeType: string
  size: number
  attachmentId: string
  messageId: string
}

export interface GmailMessage {
  id: string
  from: string
  to: string
  date: string
  subject: string
  snippet: string
  bodyText: string
  hasAttachment: boolean
  attachmentNames: string[]
  attachments: GmailAttachment[]
}

function createGmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })
  return google.gmail({ version: 'v1', auth })
}

export async function fetchContractThreads(accessToken: string): Promise<GmailThread[]> {
  const gmail = createGmailClient(accessToken)

  const queries = [
    'subject:合約審閱',
    '合約審閱',
    'GR 合約',
    'GR 用印',
    'GR contract',
    'GR agreement',
    'GR NDA',
  ]
  const allThreadIds = new Set<string>()

  for (const q of queries) {
    let pageToken: string | undefined
    let queryCount = 0
    do {
      const res = await gmail.users.threads.list({
        userId: 'me',
        q,
        maxResults: 500,
        pageToken,
      })
      const page = res.data.threads || []
      for (const t of page) {
        if (t.id) allThreadIds.add(t.id)
      }
      queryCount += page.length
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
    console.log(`[Gmail] query="${q}" 找到 ${queryCount} 個 thread`)
  }

  console.log(`[Gmail] 去重後共找到 ${allThreadIds.size} 個候選合約 thread`)

  const results: GmailThread[] = []

  // Batch fetch with concurrency limit
  const batchSize = 10
  const ids = Array.from(allThreadIds)
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const resolved = await Promise.all(
      batch.map(id => fetchThread(gmail, id).catch(() => null))
    )
    for (const thread of resolved) {
      if (thread && isContractLikeThread(thread)) results.push(thread)
    }
  }

  console.log(`[Gmail] 合約 thread 通過過濾 ${results.length}/${allThreadIds.size}`)
  return results
}

function isContractLikeThread(thread: GmailThread): boolean {
  const text = [
    thread.subject,
    ...thread.messages.flatMap(m => [m.subject, m.snippet, m.bodyText.slice(0, 500)]),
  ].join(' ')
  return CONTRACT_LIKE_PATTERN.test(text)
}

export async function fetchThreadByGrNumber(accessToken: string, grNumber: string): Promise<GmailThread | null> {
  const gmail = createGmailClient(accessToken)

  // 優先搜有 [合約審閱] 的 thread；找不到再放寬搜整個信箱（標題或內容含 GR 號）
  const queries = [
    `subject:合約審閱 subject:${grNumber}`,  // 標準格式
    `subject:合約審閱 ${grNumber}`,           // GR 在內容
    grNumber,                                  // 最廣：信箱全文搜尋
  ]

  for (const q of queries) {
    const res = await gmail.users.threads.list({ userId: 'me', q, maxResults: 5 })
    const threads = res.data.threads || []
    if (threads.length === 0) continue

    const resolved = await Promise.all(
      threads.map(t => fetchThread(gmail, t.id!).catch(() => null))
    )
    const valid = resolved.filter(Boolean) as GmailThread[]
    // 只取確實含這個 GR 號的 thread
    const matched = valid.filter(t => t.grNumber.toUpperCase() === grNumber.toUpperCase())
    if (matched.length === 0) continue

    // 多個符合時取訊息數最多的（主要合約 thread）
    return matched.reduce((best, t) => t.messages.length > best.messages.length ? t : best)
  }

  return null
}

export async function fetchInvoiceEmails(accessToken: string): Promise<Map<string, { appliedAt: string; amount: string | null }>> {
  const gmail = createGmailClient(accessToken)
  const map = new Map<string, { appliedAt: string; amount: string | null }>()

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'subject:"Thanks for filling out this form: Garena 發票開立申請單"',
    maxResults: 100,
  })

  const messages = res.data.messages || []
  for (const m of messages) {
    try {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id! })
      const headers = msg.data.payload?.headers || []
      const subject = headers.find(h => h.name === 'Subject')?.value || ''
      const date = headers.find(h => h.name === 'Date')?.value || ''
      const snippet = msg.data.snippet || ''

      if (!INVOICE_SUBJECT.test(subject)) continue

      const grMatch = snippet.match(GR_NUMBER_PATTERN)
      if (!grMatch) continue

      const grNumber = grMatch[0]
      const amountMatch = snippet.match(/NT\$?[\d,]+|NTD\s*[\d,]+|[\d,]+\s*元/)

      map.set(grNumber, {
        appliedAt: new Date(date).toISOString(),
        amount: amountMatch ? amountMatch[0] : null,
      })
    } catch {
      // skip malformed messages
    }
  }

  return map
}

function decodeBase64(str: string): string {
  try {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBodyText(payload: any, maxChars = 3000): string {
  if (!payload) return ''
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64(payload.body.data).slice(0, maxChars)
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64(part.body.data).slice(0, maxChars)
      }
    }
    for (const part of payload.parts) {
      const text = extractBodyText(part, maxChars)
      if (text) return text
    }
  }
  return ''
}

async function fetchThread(
  gmail: ReturnType<typeof google.gmail>,
  threadId: string
): Promise<GmailThread | null> {
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  })

  const messages = res.data.messages || []
  const parsedMessages: GmailMessage[] = []

  let subject = ''
  let grNumber = ''

  for (const msg of messages) {
    const headers = msg.payload?.headers || []
    const from = headers.find(h => h.name === 'From')?.value || ''
    const to = headers.find(h => h.name === 'To')?.value || ''
    const msgSubject = headers.find(h => h.name === 'Subject')?.value || ''
    const date = headers.find(h => h.name === 'Date')?.value || ''

    // 只要 subject 有「合約審閱」就存下來當 thread subject
    if (CONTRACT_SUBJECT_PATTERN.test(msgSubject)) {
      if (!subject) subject = msgSubject
    }

    // GR 號碼：掃所有 message 的 subject（不限合約審閱格式）
    if (!grNumber) {
      const grMatch = msgSubject.match(GR_NUMBER_PATTERN)
      if (grMatch) grNumber = grMatch[0].replace(/[\s\-]/g, '').toUpperCase()
    }

    // Filter out Mailsuite tracking messages
    if (MAILSUITE_FILTER.test(from)) continue

    const allParts = collectParts(msg.payload)
    const attachments: GmailAttachment[] = []
    for (const part of allParts) {
      if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
          messageId: msg.id!,
        })
      }
    }
    const attachmentNames = attachments.map(a => a.filename)

    parsedMessages.push({
      id: msg.id!,
      from,
      to,
      date: date ? new Date(date).toISOString() : '',
      subject: msgSubject,
      snippet: msg.snippet || '',
      bodyText: extractBodyText(msg.payload),
      hasAttachment: attachments.length > 0,
      attachmentNames,
      attachments,
    })
  }

  // Fallback: scan snippets and body text for GR number if not found in any subject
  if (!grNumber) {
    for (const msg of parsedMessages) {
      const grMatch = (msg.snippet + ' ' + msg.bodyText).match(GR_NUMBER_PATTERN)
      if (grMatch) {
        grNumber = grMatch[0].replace(/[\s\-]/g, '').toUpperCase()
        break
      }
    }
  }

  if (!grNumber) {
    console.warn(`[Gmail] thread ${threadId} 無法取得 GR 號碼，略過（subject: "${subject}"）`)
    return null
  }

  // Use the most descriptive subject (the one with [合約審閱])
  if (!subject && parsedMessages.length > 0) subject = parsedMessages[0].subject

  return { threadId, grNumber, subject, messages: parsedMessages }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectParts(payload: any): any[] {
  if (!payload) return []
  const result = [payload]
  if (payload.parts) {
    for (const part of payload.parts) {
      result.push(...collectParts(part))
    }
  }
  return result
}

export function stripQuotedContent(text: string): string {
  if (!text) return ''
  const lines = text.split('\n')
  const result: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('>')) continue
    if (/^On .{10,300} wrote:$/.test(trimmed)) break
    if (/^於 .{5,300} 寫道：$/.test(trimmed)) break
    if (/^[-]{10,}$/.test(trimmed)) break
    if (/^[_]{10,}$/.test(trimmed)) break
    if (/^={10,}$/.test(trimmed)) break
    if (/^(From|寄件者|發件人|寄件人):\s+/i.test(trimmed) && result.length > 3) break
    if (/^(Sent|傳送時間|日期|Date):\s+/i.test(trimmed) && result.length > 3) break
    result.push(line)
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function getEmailRole(
  from: string,
  teamMembers?: { email: string; role: string }[]
): EmailTimelineItem['role'] {
  const emailLower = from.toLowerCase()

  if (/no-reply|noreply|mailer-daemon|mailsuite|postmaster/i.test(emailLower)) return '系統'

  // 先查 DB 的 teamMembers
  if (teamMembers && teamMembers.length > 0) {
    for (const m of teamMembers) {
      if (emailLower.includes(m.email.toLowerCase())) {
        return m.role as EmailTimelineItem['role']
      }
    }
  }

  // 不管有沒有 teamMembers，hardcoded 清單一定查（避免法務被誤判成 BD）
  if (LEGAL_TEAM.some(e => emailLower.includes(e))) return '法務'
  if (FINANCE_TEAM.some(e => emailLower.includes(e))) return '財務'
  if (BD_TEAM.some(e => emailLower.includes(e))) return 'BD'

  // Domain-based fallback
  if (emailLower.includes('@sea.com')) return '財務'
  if (emailLower.includes('@garena.com')) return 'BD'

  return '其他'
}

export function extractLatestContractVersion(messages: GmailMessage[]): string | null {
  const versionPattern = /v(\d+)[\._]/i
  let latestVersion: number | null = null
  let versionStr: string | null = null

  for (const msg of messages) {
    for (const name of msg.attachmentNames) {
      const match = name.match(versionPattern)
      if (match) {
        const v = parseInt(match[1])
        if (latestVersion === null || v > latestVersion) {
          latestVersion = v
          versionStr = `v${v}`
        }
      }
    }
  }

  return versionStr
}

export function extractAppliedDate(messages: GmailMessage[]): string | null {
  const datePattern = /您於\s*(\d{4}\/\d{2}\/\d{2}|\_{2,}\d{4}\/\d{2}\/\d{2}\_{2,})\s*提交/
  for (const msg of messages) {
    const match = msg.snippet.match(datePattern)
    if (match) {
      const dateStr = match[1].replace(/_/g, '').trim()
      try {
        return new Date(dateStr).toISOString()
      } catch {
        return null
      }
    }
  }
  return null
}

export function detectFinanceInfo(messages: GmailMessage[]): FinanceInfo {
  let confirmed = false
  let paymentTermsConfirmed = false

  for (const msg of messages) {
    const role = getEmailRole(msg.from)
    const snippet = msg.snippet

    if (role === '財務') {
      if (/付款條件沒有問題|財務沒有問題|payment.*ok|沒問題/i.test(snippet)) {
        confirmed = true
        paymentTermsConfirmed = true
      }
    }
  }

  return { confirmed, paymentTermsConfirmed }
}
