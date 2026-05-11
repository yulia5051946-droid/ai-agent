import Anthropic from '@anthropic-ai/sdk'
import type { GmailThread, GmailMessage } from './gmail'
import { getEmailRole, stripQuotedContent } from './gmail'
import type { ContractStatus, EmailTimelineItem } from '@/types'

type TeamMemberLike = { email: string; role: string; displayName: string }

const STATIC_STATUS_VALUES = [
  '法務尚未回覆', '確定法務負責人', '待財務確認',
  '已提供最終清稿待用印', '合約完成', '合約取消',
] as const

const DYNAMIC_STATUS_PREFIXES = ['法務已提供', '已提供', '品牌已反饋']

function isValidStatus(s: string): boolean {
  if (STATIC_STATUS_VALUES.includes(s as typeof STATIC_STATUS_VALUES[number])) return true
  return DYNAMIC_STATUS_PREFIXES.some(prefix => s.startsWith(prefix))
}

async function analyzeStatusWithAI(
  recentEmails: { from: string; role: string; date: string; body: string }[],
  subject: string,
  contractVersion: string | null
): Promise<ContractStatus | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const emailBlock = recentEmails.map((e, i) => {
    const idx = recentEmails.length - i
    return `--- 第 ${idx} 封（最新）---\n寄件人：${e.from}（${e.role}）\n時間：${e.date}\n內容：\n${e.body}`
  }).join('\n\n')

  const versionHint = contractVersion ? `目前附件中最新合約版本：${contractVersion}` : '尚未偵測到合約版本號'

  const prompt = `你是合約追蹤助理，請閱讀以下合約郵件（最新一封在最前面），判斷合約目前處於哪個階段。

合約主旨：${subject}
${versionHint}

${emailBlock}

請根據郵件實際討論的內容判斷狀態，狀態只能是以下其中一個（X 請替換為實際版本號，若不知道就用 1）：
- 法務尚未回覆：BD 已送出申請，但法務尚未有任何回覆
- 確定法務負責人：法務已有回覆，但尚未確認由誰負責審閱本案
- 待財務確認：財務尚未確認付款條件
- 法務已提供(第X版)合約 待BD反饋：法務在與 BD 的往來中提供了合約版本，請 BD 確認是否可對外
- 已提供(第X版) 待品牌反饋：BD 已將合約版本提供給品牌方，等待品牌回覆
- 品牌已反饋(第X版) 待法務反饋：品牌方對合約有新的意見，需要法務回應
- 已提供最終清稿待用印：條款已確認，正在安排雙方用印
- 合約完成：雙方已完成簽署或用印（終態）
- 合約取消：合作確認取消，法務或對方在郵件中明確表示不進行（終態）

只回傳 JSON，不要有其他文字：{"status":"狀態名稱（含版本號）"}`

  const client = new Anthropic({ apiKey })
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
    const parsed = JSON.parse(text.match(/\{.*\}/s)?.[0] || '{}')
    console.log(`[AI Status] ${subject.slice(0, 40)} → "${parsed.status}"`)
    if (parsed.status && isValidStatus(parsed.status)) return parsed.status as ContractStatus
  } catch (err) {
    console.error(`[AI Status] 分析失敗: ${subject.slice(0, 40)}`, String(err))
  }

  return null
}

export interface AnalysisResult {
  status: ContractStatus
  responsibleLegal: string | null
  hasAuthorizationLetter: boolean
  contractVersion: string | null
  financeConfirmed: boolean
  nextAction: string
  summary: string
  timeline: EmailTimelineItem[]
  // Extended fields
  description: string | null
  contractType: string | null
  exposureSeason: string | null
  ourProvisions: string | null
  theirProvisions: string | null
  sponsorAmountNTD: string | null
  cooperationPeriod: string | null
  responsiblePerson: string | null
  legalProgressNote: string | null
}


export async function analyzeContractThread(
  thread: GmailThread,
  teamMembers?: TeamMemberLike[]
): Promise<AnalysisResult> {
  const result = analyzeByRules(thread, teamMembers)

  // AI 分析狀態：取最近 5 封非系統信送給 Claude 判斷
  const role = (from: string) => getEmailRole(from, teamMembers)
  const recentEmails = [...thread.messages]
    .filter(m => role(m.from) !== '系統')
    .slice(-5)
    .reverse()
    .map(m => ({
      from: m.from,
      role: role(m.from),
      date: m.date ? new Date(m.date).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '',
      body: stripQuotedContent(m.bodyText || m.snippet || '').slice(0, 800),
    }))

  if (recentEmails.length > 0) {
    const aiStatus = await analyzeStatusWithAI(recentEmails, thread.subject, result.contractVersion)
    if (aiStatus !== null) result.status = aiStatus
  }

  return result
}

function analyzeByRules(thread: GmailThread, teamMembers?: TeamMemberLike[]): AnalysisResult {
  const messages = thread.messages

  // 每封信去掉 quoted reply，只保留新內容
  const cleanedMessages = messages.map(m => ({
    ...m,
    bodyText: stripQuotedContent(m.bodyText || ''),
  }))

  const allText = cleanedMessages.map(m => m.snippet + ' ' + m.bodyText).join('\n')
  const role = (from: string) => getEmailRole(from, teamMembers)

  // 以最後一封（非系統）郵件的寄件人角色判斷狀態
  const lastReal = [...cleanedMessages].reverse().find(m => role(m.from) !== '系統')

  // ── Status ──────────────────────────────────────────────────────────────
  let status: ContractStatus = '法務尚未回覆'

  if (lastReal) {
    const lastRole = role(lastReal.from)
    if (lastRole === '法務') status = '已回覆確認中'
    else if (lastRole === '財務') status = '待財務確認'
    else if (lastRole === 'BD') status = '已提供清稿待品牌反饋'
    else if (lastRole === '其他') status = '品牌已反饋'
  }

  // ── Responsible legal（從法務信找寄件人，比對 teamMembers）────────────────
  let responsibleLegal: string | null = null
  for (const msg of cleanedMessages) {
    if (role(msg.from) !== '法務') continue
    if (teamMembers) {
      const match = teamMembers.find(m => msg.from.toLowerCase().includes(m.email.toLowerCase()))
      if (match) { responsibleLegal = match.displayName; break }
    } else {
      const from = msg.from.toLowerCase()
      if (from.includes('lindai@')) { responsibleLegal = 'Laura'; break }
      if (from.includes('tsengw@')) { responsibleLegal = 'Wayne'; break }
      if (from.includes('land@'))   { responsibleLegal = 'Dora';  break }
    }
  }

  // ── Authorization letter ─────────────────────────────────────────────────
  const hasAuthorizationLetter =
    /授權書|授權信|authorization\s*letter/i.test(allText) ||
    messages.some(m => m.attachmentNames.some(n => /授權/.test(n)))

  // ── Contract version ─────────────────────────────────────────────────────
  let contractVersion: string | null = null
  const versionPattern = /v(\d+)[\._\s]/i
  for (const msg of messages) {
    for (const name of msg.attachmentNames) {
      const m = name.match(versionPattern)
      if (m) {
        const v = parseInt(m[1])
        if (!contractVersion || v > parseInt(contractVersion.replace('v', ''))) {
          contractVersion = `v${v}`
        }
      }
    }
  }

  // ── Finance confirmed ────────────────────────────────────────────────────
  const financeConfirmed = cleanedMessages.some(m =>
    role(m.from) === '財務' &&
    /付款條件沒有問題|財務沒有問題|payment\s*ok|沒問題|確認無誤|付款條件確認|財務確認|ok.*付款|approve/i.test(m.snippet + m.bodyText)
  )

  // ── Contract type ────────────────────────────────────────────────────────
  const contractType = detectContractType(thread.subject)

  // ── Description (from subject) ───────────────────────────────────────────
  const description = extractDescription(thread.subject)

  // ── Exposure season ──────────────────────────────────────────────────────
  const exposureSeason = detectExposureSeason(thread.subject + ' ' + allText)

  // ── Sponsor amount ───────────────────────────────────────────────────────
  const sponsorAmountNTD = extractSponsorAmount(allText)

  // ── Cooperation period ───────────────────────────────────────────────────
  const cooperationPeriod = extractCooperationPeriod(allText)

  // ── Our/their provisions ─────────────────────────────────────────────────
  const { ourProvisions, theirProvisions } = extractProvisions(allText)

  // ── Responsible person（BD 寄件人，比對 teamMembers）──────────────────────
  let responsiblePerson: string | null = null
  for (const msg of cleanedMessages) {
    if (role(msg.from) !== 'BD') continue
    if (teamMembers) {
      const match = teamMembers.find(m => msg.from.toLowerCase().includes(m.email.toLowerCase()))
      if (match) { responsiblePerson = match.displayName; break }
    } else {
      const from = msg.from.toLowerCase()
      if (from.includes('liny@'))   { responsiblePerson = 'Yulia'; break }
      if (from.includes('chenla@')) { responsiblePerson = 'Larry'; break }
    }
  }

  // ── Legal progress note（最新法務信的清理後全文，最多 500 字）────────────
  let legalProgressNote: string | null = null
  const legalMsgs = cleanedMessages.filter(m => role(m.from) === '法務')
  if (legalMsgs.length > 0) {
    const latest = legalMsgs[legalMsgs.length - 1]
    const text = (latest.bodyText || latest.snippet).slice(0, 500).trim()
    if (text) legalProgressNote = text
  }

  // ── Next action ──────────────────────────────────────────────────────────
  let nextAction = '請確認合約最新進度'
  if (status === '法務尚未回覆') nextAction = '催促法務回覆合約審閱意見'
  else if (status === '確定法務負責人') nextAction = '確認負責法務人員並確認申請無誤'
  else if (status === '待財務確認') nextAction = '等待財務確認付款條件'
  else if (status.startsWith('法務已提供')) nextAction = '確認法務提供的合約版本，決定是否可對外提供品牌'
  else if (status.startsWith('已提供')) nextAction = '催促品牌回覆合約意見'
  else if (status.startsWith('品牌已反饋')) nextAction = '將品牌意見轉交法務處理'
  else if (status === '已提供最終清稿待用印') nextAction = '追蹤用印進度，確認雙方完成簽署'
  else if (status === '合約完成') nextAction = '確認用印文件已歸檔'
  else if (status === '合約取消') nextAction = '無需後續行動'

  const lastMsg = messages[messages.length - 1]
  const summary = `合約 ${thread.grNumber}（${contractType}）目前狀態：${status}。共 ${messages.length} 封郵件往來。最後更新：${lastMsg?.date ? new Date(lastMsg.date).toLocaleDateString('zh-TW') : '不明'}。`

  return {
    status,
    responsibleLegal,
    hasAuthorizationLetter,
    contractVersion,
    financeConfirmed,
    nextAction,
    summary,
    timeline: buildBasicTimeline(cleanedMessages),
    description,
    contractType,
    exposureSeason,
    ourProvisions,
    theirProvisions,
    sponsorAmountNTD,
    cooperationPeriod,
    responsiblePerson,
    legalProgressNote,
  }
}

function detectContractType(subject: string): string {
  if (/NDA|保密合約|保密協議|保密/i.test(subject)) return 'NDA / 保密合約'
  if (/贊助/i.test(subject)) return '贊助合約'
  if (/授權/i.test(subject)) return '授權合約'
  if (/聯名/i.test(subject)) return '聯名合作合約'
  if (/代言/i.test(subject)) return '代言合約'
  if (/服務/i.test(subject)) return '服務合約'
  if (/合作/i.test(subject)) return '合作合約'
  return '合約'
}

export function extractDescription(subject: string): string | null {
  // Format: [合約審閱]GAME(alias)_Company_Description - GR######
  let s = subject.replace(/\[合約審閱\]\s*/i, '').replace(/\s*-\s*GR\d+\s*$/i, '').trim()
  const parts = s.split('_')
  if (parts.length >= 3) {
    // 去重複：description 段可能因 subject 格式重複出現
    const descParts = parts.slice(2)
    const unique = descParts.filter((p, i) => descParts.indexOf(p) === i)
    return unique.join(' ').trim() || null
  }
  if (parts.length === 2) return parts[1].trim() || null
  return s.trim() || null
}

function detectExposureSeason(text: string): string | null {
  const m = text.match(/S(\d{1,2})(?:[^0-9]|$)|第\s*(\d{1,2})\s*賽季|Season\s*(\d{1,2})/i)
  if (!m) return null
  const n = m[1] || m[2] || m[3]
  return n ? `S${n}` : null
}

function extractSponsorAmount(text: string): string | null {
  const m = text.match(/NT\$?\s*([\d,]+)|NTD\s*([\d,]+)|([\d,]+)\s*元/)
  if (!m) return null
  const amount = (m[1] || m[2] || m[3]).replace(/,/g, '')
  return `NT$ ${parseInt(amount).toLocaleString('zh-TW')}`
}

function extractCooperationPeriod(text: string): string | null {
  const m = text.match(/(\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?)\s*(?:至|~|－|—|-)\s*(\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?)/)
  if (!m) return null
  return `${m[1]} ~ ${m[2]}`
}

function extractProvisions(text: string): { ourProvisions: string | null; theirProvisions: string | null } {
  let ourProvisions: string | null = null
  let theirProvisions: string | null = null

  const ourMatch = text.match(/Garena[^：:]*(?:提供|給予)[：:\s]*([^。\n]{5,80})/)
  if (ourMatch) ourProvisions = ourMatch[1].trim()

  const theirMatch = text.match(/(?:品牌方|對方|乙方)[^：:]*(?:提供|給予|贊助)[：:\s]*([^。\n]{5,80})/)
  if (theirMatch) theirProvisions = theirMatch[1].trim()

  return { ourProvisions, theirProvisions }
}

function buildBasicTimeline(messages: GmailMessage[]): EmailTimelineItem[] {
  return messages.map(msg => ({
    date: msg.date,
    from: msg.from,
    role: getEmailRole(msg.from),
    summary: (msg.bodyText || msg.snippet).slice(0, 2000),
    attachments: msg.attachments?.length ? msg.attachments.map(a => ({
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      attachmentId: a.attachmentId,
      messageId: a.messageId,
    })) : undefined,
  }))
}

export async function generateDailyReportContent(contracts: {
  grNumber: string
  partner: string
  status: ContractStatus
  lastEmailAt: string | null
  daysStale: number
  nextAction: string | null
}[]): Promise<string> {
  const today = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const overdue = contracts.filter(c => c.daysStale >= 14)
  const warning = contracts.filter(c => c.daysStale >= 7 && c.daysStale < 14)
  const active = contracts.filter(c => !['合約取消', '合約完成'].includes(c.status))

  const formatList = (items: typeof contracts) =>
    items.map(c =>
      `• ${c.grNumber} ${c.partner}｜${c.status}｜${c.daysStale} 天未更新｜${c.nextAction || '待確認'}`
    ).join('\n')

  return `===== Garena BD 合約追蹤日報 ${today} =====

🔴 逾期警示（14天以上未更新）：${overdue.length} 件
${overdue.length > 0 ? formatList(overdue) : '（無）'}

🟡 注意（7-13天未更新）：${warning.length} 件
${warning.length > 0 ? formatList(warning) : '（無）'}

📋 所有進行中合約（${active.length} 件）：
${active.length > 0 ? formatList(active) : '（無）'}

---
此為自動發送，請勿直接回覆。
如需查看詳情，請至合約追蹤平台。`
}
