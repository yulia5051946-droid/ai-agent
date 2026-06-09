import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { fetchThreadByGrNumber } from '@/lib/gmail'
import { analyzeContractThread, extractDescription } from '@/lib/claude'
import { fetchAllSheetData, filterSheetDataByGame, matchSheetData, writeGrNumberToSheet } from '@/lib/sheets'
import { upsertContractCache, getContractCache, getAllTeamMembers, isBDMember, saveEmailTimeline } from '@/lib/db'
import { extractLatestContractVersion, extractAppliedDate, detectFinanceInfo } from '@/lib/gmail'
import type { ContractStatus, GameType, SheetContractData } from '@/types'

function detectGame(subject: string): GameType {
  if (/\bAOV\b|傳說對決|Arena of Valor/i.test(subject)) return 'AOV'
  if (/\bCODM\b|使命召喚/i.test(subject)) return 'CODM'
  if (/\bDF\b|決鬥|Undawn/i.test(subject)) return 'DF'
  return 'unknown'
}

function extractPartnerFromSubject(subject: string): string {
  const match = subject.match(/\[合約審閱\][^_]*_([^_]+)_/)
  return match ? match[1].trim() : subject.replace(/\[合約審閱\].*?[-–]\s*GR\d+/i, '').trim()
}

// POST /api/contracts/search
// body: { grNumber: string }
// 直接到 Gmail 搜尋指定 GR 號，找到後分析並加進快取
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  // 只有 BD 成員可以搜尋（避免非 BD 登入後觸發 Gmail 查詢）
  if (!isBDMember(session.user?.email || '')) {
    return NextResponse.json({ error: '只有 BD 成員可以搜尋新合約' }, { status: 403 })
  }

  const body = await request.json() as { grNumber?: string }
  const raw = (body.grNumber || '').trim().toUpperCase()

  // 允許只輸入數字（如 1164 → GR001164）或完整 GR 號
  const grNumber = /^\d+$/.test(raw)
    ? `GR${raw.padStart(6, '0')}`
    : raw.startsWith('GR') ? raw : `GR${raw}`

  if (!/^GR\d{3,8}$/.test(grNumber)) {
    return NextResponse.json({ error: `無效的 GR 號碼：${raw}` }, { status: 400 })
  }

  // 先看快取裡有沒有（已存在就直接回傳）
  const existing = getContractCache(grNumber)
  if (existing) {
    return NextResponse.json({ found: true, grNumber, cached: true, partner: existing.partner, status: existing.status })
  }

  // 去 Gmail 搜尋
  const thread = await fetchThreadByGrNumber(session.accessToken, grNumber).catch(() => null)
  if (!thread) {
    return NextResponse.json({ found: false, grNumber, message: `Gmail 中找不到 ${grNumber} 相關的郵件` })
  }

  // 分析並存入快取
  try {
    const teamMembers = getAllTeamMembers()
    const analysis = await analyzeContractThread(thread, teamMembers)
    saveEmailTimeline(grNumber, analysis.timeline)
    const lastMsg = thread.messages[thread.messages.length - 1]
    const contractVersion = extractLatestContractVersion(thread.messages)
    const appliedAt = extractAppliedDate(thread.messages)
    const financeInfo = detectFinanceInfo(thread.messages)
    const partner = extractPartnerFromSubject(thread.subject)
    const emailDesc = extractDescription(thread.subject)
    const detectedGame = detectGame(thread.subject)

    // Sheet 比對
    let sheetData: SheetContractData | null = null
    try {
      const allSheetData = await fetchAllSheetData(session.accessToken)
      const gameSheetData = filterSheetDataByGame(allSheetData, detectedGame)
      sheetData = matchSheetData(partner, gameSheetData, emailDesc, grNumber)
      if (sheetData && sheetData._grLinked !== grNumber) {
        writeGrNumberToSheet(session.accessToken, sheetData, grNumber).catch(() => {})
      }
    } catch { /* optional */ }

    const finalGame: GameType = (sheetData?.game as GameType | undefined) ?? detectedGame

    upsertContractCache({
      grNumber,
      threadId: thread.threadId,
      game: finalGame,
      gameManual: false,
      partner,
      subject: thread.subject,
      appliedAt,
      lastEmailAt: lastMsg?.date || null,
      status: analysis.status as ContractStatus,
      responsibleLegal: analysis.responsibleLegal,
      hasAuthorizationLetter: analysis.hasAuthorizationLetter,
      contractVersion: contractVersion || analysis.contractVersion,
      financeConfirmed: analysis.financeConfirmed || financeInfo.confirmed,
      nextAction: analysis.nextAction,
      summary: analysis.summary,
      updatedAt: new Date().toISOString(),
      description: sheetData?.description || null,
      contractType: sheetData?.type || null,
      exposureSeason: sheetData?.exposureSeason || null,
      ourProvisions: sheetData?.ourProvisions || null,
      theirProvisions: sheetData?.theirProvisions || null,
      sponsorAmountNTD: sheetData?.sponsorAmountNTD || null,
      sponsorAmountUSD: sheetData?.sponsorAmountUSD || null,
      cooperationPeriod: sheetData?.cooperationPeriod || null,
      responsiblePerson: analysis.responsiblePerson || sheetData?.responsiblePerson || null,
      legalProgressNote: analysis.legalProgressNote,
    })

    return NextResponse.json({
      found: true,
      grNumber,
      cached: false,
      partner,
      status: analysis.status,
      subject: thread.subject,
      messageCount: thread.messages.length,
    })
  } catch (err) {
    return NextResponse.json({ error: `分析失敗：${String(err)}` }, { status: 500 })
  }
}
