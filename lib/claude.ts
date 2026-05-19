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

function detectStatusByKeywords(
  legalEmail: { body: string; date: string; attachmentNames?: string[] } | null,
  financeEmail: { body: string } | null,
  bdEmail: { body: string; date: string; attachmentNames?: string[] } | null,
  contractVersion: string | null,
  grNumber: string
): ContractStatus | null {
  if (!legalEmail && !bdEmail) return null  // 完全沒有法務或 BD 信，維持預設

  // 版本號（去掉 v 前綴，只保留數字）
  const ver = contractVersion ? contractVersion.replace(/^v/i, '') : '1'

  const legalBody = legalEmail?.body.toLowerCase() ?? ''
  const financeBody = financeEmail?.body.toLowerCase() ?? ''
  const bdBody = bdEmail?.body.toLowerCase() ?? ''

  // 財務是否已確認
  // 若財務信同時包含「請調整/請說明/請補充」等要求，視為尚未確認（部分有問題）
  const financeHasRequest = /請調整|請修改|需要調整|請說明|請補充|請提供|請確認.*以下|please.*adjust|please.*clarify|please.*provide|please.*confirm.*below/i.test(financeBody)
  const financeOk = financeEmail !== null &&
    !financeHasRequest &&
    /沒有意見|沒有其他意見|沒有問題|確認|no.*comment|no further|ok|approve|財務確認|payment.*ok/i.test(financeBody)

  // 法務信關鍵字
  const isCleanDraft = legalEmail !== null && (
    /clean|清稿|\[clean\]|final.*version|最終版|no further comment|no.*further.*comment|legal has no further|沒有其他意見|法律沒有意見|審閱完畢|沒有修改|無修改意見/i.test(legalBody) ||
    /\[clean\]/i.test(legalEmail.attachmentNames?.join(' ') ?? '')
  )

  const legalHasDraft = legalEmail !== null && (
    /請.*確認|provide.*draft|附上|如附件|as attached|draft|合約版本|提供.*合約|版本/i.test(legalBody) ||
    (legalEmail.attachmentNames?.length ?? 0) > 0
  )

  const isCancel = /取消|cancel|不進行|終止|withdraw/i.test(legalBody + ' ' + bdBody)
  const isComplete = /用印完成|雙方.*簽署|signed|完成簽署|執行本/i.test(legalBody + ' ' + bdBody)

  // BD 信關鍵字
  // 品牌已給反饋（優先判斷，避免被附件誤判成送出）
  const bdGotBrandFeedback =
    /反饋|feedback|品牌.*意見|廠商.*回覆|brand.*comment|對方.*意見|他們.*說|廠商.*說|修改意見|回覆如附件|意見如附件|請再確認|請.*review|please.*review|please.*confirm.*again/i.test(bdBody)

  // BD 主動送出合約給品牌（附件本身不算，要有送出的動詞）
  const bdSentToBrand = !bdGotBrandFeedback && (
    /提供.*品牌|送出.*合約|已傳給|forward|寄給.*廠商|provide.*brand|已送出|send.*contract|已提供.*品牌|品牌.*確認.*版本/i.test(bdBody) ||
    ((bdEmail?.attachmentNames?.length ?? 0) > 0 &&
      /請.*確認(?!.*反饋)|please.*check|供.*參考|如附件.*請.*確認/i.test(bdBody))
  )

  // BD 的最後一封信是否比法務的更新
  const bdIsNewer = bdEmail !== null && legalEmail !== null &&
    new Date(bdEmail.date) > new Date(legalEmail.date)

  const onlyBD = bdEmail !== null && legalEmail === null

  // 判斷邏輯（終態優先）
  if (isComplete) { console.log(`[Rules ${grNumber}] 合約完成`); return '合約完成' }
  if (isCancel)   { console.log(`[Rules ${grNumber}] 合約取消`); return '合約取消' }

  // 法務清稿後：看 BD 是否有後續動作
  // 注意：財務狀態由 financeConfirmed 欄位獨立追蹤，不影響主要合約狀態
  if (isCleanDraft) {
    if ((bdIsNewer || onlyBD) && bdGotBrandFeedback) {
      console.log(`[Rules ${grNumber}] 法務清稿 → BD 收到品牌反饋 → 品牌已反饋(第${ver}版) 待法務反饋`)
      return `品牌已反饋(第${ver}版) 待法務反饋` as ContractStatus
    }
    if ((bdIsNewer || onlyBD) && bdSentToBrand) {
      console.log(`[Rules ${grNumber}] 法務清稿 → BD 已送品牌 → 已提供(第${ver}版) 待品牌反饋`)
      return `已提供(第${ver}版) 待品牌反饋` as ContractStatus
    }
    // 財務確認狀態透過 financeConfirmed badge 單獨顯示，主狀態顯示法務進度
    console.log(`[Rules ${grNumber}] 法務清稿（財務狀態獨立追蹤）→ 已提供最終清稿待用印`)
    return '已提供最終清稿待用印'
  }

  // 法務提供版本後：看 BD 是否有後續動作
  if (legalHasDraft) {
    if ((bdIsNewer || onlyBD) && bdGotBrandFeedback) {
      console.log(`[Rules ${grNumber}] 法務提供版本 → BD 收到品牌反饋 → 品牌已反饋(第${ver}版) 待法務反饋`)
      return `品牌已反饋(第${ver}版) 待法務反饋` as ContractStatus
    }
    if ((bdIsNewer || onlyBD) && bdSentToBrand) {
      console.log(`[Rules ${grNumber}] 法務提供版本 → BD 已送品牌 → 已提供(第${ver}版) 待品牌反饋`)
      return `已提供(第${ver}版) 待品牌反饋` as ContractStatus
    }
    console.log(`[Rules ${grNumber}] 法務提供版本 → 法務已提供(第${ver}版)合約 待BD反饋`)
    return `法務已提供(第${ver}版)合約 待BD反饋` as ContractStatus
  }

  // 只有 BD 的信（法務尚未回覆或不在 thread）
  if (onlyBD) {
    if (bdGotBrandFeedback) {
      console.log(`[Rules ${grNumber}] 僅 BD（品牌已反饋）→ 品牌已反饋(第${ver}版) 待法務反饋`)
      return `品牌已反饋(第${ver}版) 待法務反饋` as ContractStatus
    }
    if (bdSentToBrand) {
      console.log(`[Rules ${grNumber}] 僅 BD（已送品牌）→ 已提供(第${ver}版) 待品牌反饋`)
      return `已提供(第${ver}版) 待品牌反饋` as ContractStatus
    }
  }

  // 法務有回覆但沒有明確動作
  if (legalEmail) {
    console.log(`[Rules ${grNumber}] 法務已回覆（無明確動作）→ 確定法務負責人`)
    return '確定法務負責人'
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

  // AI 分析狀態：法務最後一封 + 財務最後一封，合併給 AI 判斷綜合狀態
  const role = (from: string) => getEmailRole(from, teamMembers)

  const lastLegalMsg   = [...thread.messages].filter(m => role(m.from) === '法務').at(-1)
  const lastFinanceMsg = [...thread.messages].filter(m => role(m.from) === '財務').at(-1)
  const lastBDMsg      = [...thread.messages].filter(m => role(m.from) === 'BD').at(-1)

  const legalEntry = lastLegalMsg ? {
    body: stripQuotedContent(lastLegalMsg.bodyText || lastLegalMsg.snippet || ''),
    date: lastLegalMsg.date || '',
    attachmentNames: lastLegalMsg.attachmentNames,
  } : null

  const financeEntry = lastFinanceMsg ? {
    body: stripQuotedContent(lastFinanceMsg.bodyText || lastFinanceMsg.snippet || ''),
  } : null

  const bdEntry = lastBDMsg ? {
    body: stripQuotedContent(lastBDMsg.bodyText || lastBDMsg.snippet || ''),
    date: lastBDMsg.date || '',
    attachmentNames: lastBDMsg.attachmentNames,
  } : null

  const detectedStatus = detectStatusByKeywords(legalEntry, financeEntry, bdEntry, result.contractVersion, thread.grNumber)
  if (detectedStatus !== null) {
    result.status = detectedStatus
    result.nextAction = deriveNextAction(detectedStatus)
    const lastMsg = thread.messages[thread.messages.length - 1]
    result.summary = deriveSum(thread.grNumber, result.contractType, detectedStatus, thread.messages.length, lastMsg?.date ?? null)
  }

  return result
}

function deriveNextAction(status: ContractStatus): string {
  if (status === '法務尚未回覆') return '催促法務回覆合約審閱意見'
  if (status === '確定法務負責人') return '確認負責法務人員並確認申請無誤'
  if (status === '待財務確認') return '等待財務確認付款條件'
  if (status.startsWith('法務已提供')) return '確認法務提供的合約版本，決定是否可對外提供品牌'
  if (status.startsWith('已提供')) return '催促品牌回覆合約意見'
  if (status.startsWith('品牌已反饋')) return '將品牌意見轉交法務處理'
  if (status === '已提供最終清稿待用印') return '確認財務付款條件，並追蹤用印進度'
  if (status === '合約完成') return '確認用印文件已歸檔'
  if (status === '合約取消') return '無需後續行動'
  return '請確認合約最新進度'
}

function deriveSum(grNumber: string, contractType: string | null, status: ContractStatus, msgCount: number, lastDate: string | null): string {
  const dateStr = lastDate ? new Date(lastDate).toLocaleDateString('zh-TW') : '不明'
  return `合約 ${grNumber}（${contractType ?? '合約'}）目前狀態：${status}。共 ${msgCount} 封郵件往來。最後更新：${dateStr}。`
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

  // ── Status 預設值：法務尚未回覆（實際狀態由 AI 在 analyzeContractThread 覆寫）──
  const status: ContractStatus = '法務尚未回覆'

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
  // 若財務信含「請調整/請說明」等要求性語句，代表尚未完全確認，不算 confirmed
  const financeConfirmed = cleanedMessages.some(m => {
    if (role(m.from) !== '財務') return false
    const text = m.snippet + m.bodyText
    const hasRequest = /請調整|請修改|需要調整|請說明|請補充|請提供|請確認.*以下/i.test(text)
    if (hasRequest) return false
    return /付款條件沒有問題|財務沒有問題|payment\s*ok|沒問題|確認無誤|付款條件確認|財務確認|ok.*付款|approve/i.test(text)
  })

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

  const nextAction = deriveNextAction(status)

  const lastMsg = messages[messages.length - 1]
  const summary = deriveSum(thread.grNumber, contractType, status, messages.length, lastMsg?.date ?? null)

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
