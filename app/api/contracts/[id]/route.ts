import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { fetchThreadByGrNumber } from '@/lib/gmail'
import { analyzeContractThread, extractDescription } from '@/lib/claude'
import { fetchAllSheetData, filterSheetDataByGame, matchSheetData, writeGrNumberToSheet } from '@/lib/sheets'
import { addActivityLog, getContractCache, getEmailTimeline, getManualLock, setManualLock, removeManualLock, getInvoiceRecord, isBDMember, saveEmailTimeline, setManualGame } from '@/lib/db'
import type { ContractDetail, ContractStatus, GameType } from '@/types'

function detectGame(subject: string): GameType {
  if (/\bAOV\b|傳說對決|Arena of Valor/i.test(subject)) return 'AOV'
  if (/\bCODM\b|使命召喚/i.test(subject)) return 'CODM'
  if (/\bDF\b|決鬥|Undawn/i.test(subject)) return 'DF'
  return 'unknown'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  const { id } = await params
  const grNumber = id.toUpperCase()
  const isBD = isBDMember(session.user?.email || '')
  const cached = getContractCache(grNumber)
  const lock = getManualLock(grNumber)
  const invoice = getInvoiceRecord(grNumber)

  if (!isBD) {
    if (!cached) {
      return NextResponse.json({ error: `找不到合約 ${grNumber}` }, { status: 404 })
    }
    return NextResponse.json(buildDetailFromCache(cached, lock, invoice))
  }

  // Fetch live thread from BD Gmail only
  const thread = await fetchThreadByGrNumber(session.accessToken, grNumber).catch(() => null)

  if (!thread) {
    if (!cached) {
      return NextResponse.json({ error: `找不到合約 ${grNumber}` }, { status: 404 })
    }
    return NextResponse.json(buildDetailFromCache(cached, lock, invoice))
  }

  const analysis = await analyzeContractThread(thread)
  saveEmailTimeline(grNumber, analysis.timeline)

  let sheetData = undefined
  try {
    const allSheetData = await fetchAllSheetData(session.accessToken)
    // 手動設定的遊戲優先，避免 sheet 比對結果覆寫
    const cachedGame = cached?.game as GameType | undefined
    const gameManual = cached?.gameManual ?? false
    const detectedGame = detectGame(thread.subject)
    const effectiveGame: GameType = gameManual
      ? (cachedGame ?? 'unknown')
      : (detectedGame !== 'unknown' ? detectedGame : (cachedGame ?? 'unknown'))
    const gameSheetData = filterSheetDataByGame(allSheetData, effectiveGame)
    const found = cached?.sheetLinkMode === 'manual'
      ? null
      : matchSheetData(cached?.partner || '', gameSheetData, extractDescription(thread.subject), grNumber)
    if (found) {
      sheetData = found
      if (found._grLinked !== grNumber) {
        writeGrNumberToSheet(session.accessToken, found, grNumber).catch(() => {})
      }
    }
  } catch {
    // Sheet fetch is optional
  }

  // game：手動設定不被 sheetData 覆寫
  const gameManualFlag = cached?.gameManual ?? false
  const resolvedGame = gameManualFlag
    ? (cached?.game || 'unknown')
    : (sheetData?.game || cached?.game || 'unknown')

  const status: ContractStatus = lock ? lock.status : analysis.status
  const detail: ContractDetail = {
    grNumber,
    game: resolvedGame as ContractDetail['game'],
    partner: cached?.partner || '',
    subject: thread.subject,
    appliedAt: cached?.appliedAt || null,
    lastEmailAt: thread.messages[thread.messages.length - 1]?.date || null,
    status,
    isManuallyLocked: Boolean(lock),
    manualStatus: lock?.status,
    responsibleLegal: analysis.responsibleLegal || undefined,
    hasAuthorizationLetter: analysis.hasAuthorizationLetter,
    contractVersion: analysis.contractVersion || undefined,
    financeConfirmed: analysis.financeConfirmed,
    nextAction: analysis.nextAction,
    summary: analysis.summary,
    timeline: analysis.timeline,
    sheetData,
    financeInfo: invoice
      ? {
          confirmed: Boolean(cached?.financeConfirmed),
          invoiceAppliedAt: invoice.appliedAt,
          invoiceIssuedAt: invoice.issuedAt || undefined,
          amount: invoice.amount || undefined,
        }
      : undefined,
    description: cached?.description || sheetData?.description || analysis.description || undefined,
    contractType: cached?.contractType || sheetData?.type || analysis.contractType || undefined,
    exposureSeason: cached?.exposureSeason || sheetData?.exposureSeason || analysis.exposureSeason || undefined,
    ourProvisions: cached?.ourProvisions || sheetData?.ourProvisions || analysis.ourProvisions || undefined,
    theirProvisions: cached?.theirProvisions || sheetData?.theirProvisions || analysis.theirProvisions || undefined,
    sponsorAmountNTD: cached?.sponsorAmountNTD || sheetData?.sponsorAmountNTD || analysis.sponsorAmountNTD || undefined,
    sponsorAmountUSD: cached?.sponsorAmountUSD || sheetData?.sponsorAmountUSD || undefined,
    cooperationPeriod: cached?.cooperationPeriod || sheetData?.cooperationPeriod || analysis.cooperationPeriod || undefined,
    responsiblePerson: analysis.responsiblePerson || cached?.responsiblePerson || sheetData?.responsiblePerson || undefined,
    legalProgressNote: analysis.legalProgressNote || undefined,
    sheetLinkMode: cached?.sheetLinkMode || 'auto',
  }

  return NextResponse.json(detail)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  const { id } = await params
  const grNumber = id.toUpperCase()
  const body = await request.json() as { action: 'lock' | 'unlock' | 'set-game'; status?: ContractStatus; game?: string }

  if (body.action === 'lock' && body.status) {
    const author = session.user?.email || session.user?.name || '未知使用者'
    setManualLock({
      grNumber,
      status: body.status,
      lockedBy: author,
      lockedAt: new Date().toISOString(),
    })
    addActivityLog({
      grNumber,
      action: 'lock_status',
      targetType: 'status',
      targetName: body.status,
      author,
      details: `手動設定合約狀態為「${body.status}」`,
    })
    return NextResponse.json({ success: true, locked: true, status: body.status })
  }

  if (body.action === 'unlock') {
    const author = session.user?.email || session.user?.name || '未知使用者'
    removeManualLock(grNumber)
    addActivityLog({
      grNumber,
      action: 'unlock_status',
      targetType: 'status',
      targetName: null,
      author,
      details: '取消手動鎖定合約狀態',
    })
    return NextResponse.json({ success: true, locked: false })
  }

  if (body.action === 'set-game' && body.game) {
    const author = session.user?.email || session.user?.name || '未知使用者'
    setManualGame(grNumber, body.game)
    addActivityLog({
      grNumber,
      action: 'set_game',
      targetType: 'game',
      targetName: body.game,
      author,
      details: `手動設定遊戲項目為「${body.game}」`,
    })
    return NextResponse.json({ success: true, game: body.game })
  }

  return NextResponse.json({ error: '無效的操作' }, { status: 400 })
}

function buildDetailFromCache(
  cached: NonNullable<ReturnType<typeof getContractCache>>,
  lock: ReturnType<typeof getManualLock>,
  invoice: ReturnType<typeof getInvoiceRecord>
): ContractDetail {
  return {
    grNumber: cached.grNumber,
    game: cached.game as ContractDetail['game'],
    partner: cached.partner,
    subject: cached.subject,
    appliedAt: cached.appliedAt,
    lastEmailAt: cached.lastEmailAt,
    status: lock ? lock.status : cached.status,
    isManuallyLocked: Boolean(lock),
    manualStatus: lock?.status,
    responsibleLegal: cached.responsibleLegal || undefined,
    hasAuthorizationLetter: cached.hasAuthorizationLetter,
    contractVersion: cached.contractVersion || undefined,
    financeConfirmed: cached.financeConfirmed,
    nextAction: cached.nextAction || undefined,
    summary: cached.summary || undefined,
    timeline: getEmailTimeline(cached.grNumber),
    financeInfo: invoice
      ? {
          confirmed: cached.financeConfirmed,
          invoiceAppliedAt: invoice.appliedAt,
          invoiceIssuedAt: invoice.issuedAt || undefined,
          amount: invoice.amount || undefined,
        }
      : undefined,
    description: cached.description || undefined,
    contractType: cached.contractType || undefined,
    exposureSeason: cached.exposureSeason || undefined,
    ourProvisions: cached.ourProvisions || undefined,
    theirProvisions: cached.theirProvisions || undefined,
    sponsorAmountNTD: cached.sponsorAmountNTD || undefined,
    sponsorAmountUSD: cached.sponsorAmountUSD || undefined,
    cooperationPeriod: cached.cooperationPeriod || undefined,
    responsiblePerson: cached.responsiblePerson || undefined,
    legalProgressNote: cached.legalProgressNote || undefined,
    sheetLinkMode: cached.sheetLinkMode || 'auto',
  }
}
