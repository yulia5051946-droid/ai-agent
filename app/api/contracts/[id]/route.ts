import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { fetchThreadByGrNumber } from '@/lib/gmail'
import { analyzeContractThread, extractDescription } from '@/lib/claude'
import { fetchAllSheetData, matchSheetData, writeGrNumberToSheet } from '@/lib/sheets'
import { getContractCache, getManualLock, setManualLock, removeManualLock, getInvoiceRecord, setManualGame } from '@/lib/db'
import type { ContractDetail, ContractStatus, GameType } from '@/types'

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

  // Fetch live thread from Gmail
  const thread = await fetchThreadByGrNumber(session.accessToken, grNumber).catch(() => null)

  if (!thread) {
    const cached = getContractCache(grNumber)
    if (!cached) {
      return NextResponse.json({ error: `找不到合約 ${grNumber}` }, { status: 404 })
    }
    const lock = getManualLock(grNumber)
    const invoice = getInvoiceRecord(grNumber)
    return NextResponse.json(buildDetailFromCache(cached, lock, invoice))
  }

  const analysis = await analyzeContractThread(thread)
  const lock = getManualLock(grNumber)
  const invoice = getInvoiceRecord(grNumber)

  const cached = getContractCache(grNumber)

  let sheetData = undefined
  try {
    const allSheetData = await fetchAllSheetData(session.accessToken)
    // 手動設定的遊戲優先，避免 sheet 比對結果覆寫
    const cachedGame = cached?.game as GameType | undefined
    const gameManual = cached?.gameManual ?? false
    const effectiveGame: GameType = gameManual
      ? (cachedGame ?? 'unknown')
      : (cachedGame ?? 'unknown')
    const gameSheetData = effectiveGame !== 'unknown'
      ? new Map([...allSheetData.entries()].filter(([, rows]) => rows.some(r => r.game === effectiveGame)))
      : allSheetData
    const found = matchSheetData(cached?.partner || '', gameSheetData, extractDescription(thread.subject), grNumber)
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
    description: analysis.description || undefined,
    contractType: analysis.contractType || undefined,
    exposureSeason: analysis.exposureSeason || undefined,
    ourProvisions: analysis.ourProvisions || undefined,
    theirProvisions: analysis.theirProvisions || undefined,
    sponsorAmountNTD: analysis.sponsorAmountNTD || undefined,
    cooperationPeriod: analysis.cooperationPeriod || undefined,
    responsiblePerson: analysis.responsiblePerson || undefined,
    legalProgressNote: analysis.legalProgressNote || undefined,
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
    setManualLock({
      grNumber,
      status: body.status,
      lockedBy: session.user?.email || 'unknown',
      lockedAt: new Date().toISOString(),
    })
    return NextResponse.json({ success: true, locked: true, status: body.status })
  }

  if (body.action === 'unlock') {
    removeManualLock(grNumber)
    return NextResponse.json({ success: true, locked: false })
  }

  if (body.action === 'set-game' && body.game) {
    setManualGame(grNumber, body.game)
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
    timeline: [],
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
    cooperationPeriod: cached.cooperationPeriod || undefined,
    responsiblePerson: cached.responsiblePerson || undefined,
    legalProgressNote: cached.legalProgressNote || undefined,
  }
}
