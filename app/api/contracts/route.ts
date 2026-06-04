import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { backupDatabase, getAllContractCache, getAllManualLocks, getLegalNotesMap, isBDMember, saveSyncCredential } from '@/lib/db'
import { runContractSync } from '@/lib/contract-sync'
import type { Contract, ContractStatus, GameType } from '@/types'

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }
  const accessToken = session.accessToken

  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('refresh') === 'true'

  // Check if we have recent cached data
  const cached = getAllContractCache()
  const manualLocks = getAllManualLocks()

  // Keep the normal dashboard load lightweight on low-memory deployments.
  // Gmail/Sheets/Claude modules are imported only for an explicit sync.
  if (!forceRefresh) {
    return NextResponse.json(buildContractList(cached, manualLocks))
  }

  // 只有 BD 成員可以觸發 Gmail 同步；非 BD 直接回快取
  if (!isBDMember(session.user?.email || '')) {
    return NextResponse.json(buildContractList(cached, manualLocks))
  }

  try {
    if (session.user?.email && session.refreshToken) {
      saveSyncCredential(session.user.email, session.refreshToken, accessToken, null)
    }
    await runContractSync(accessToken, { source: session.user?.email || 'manual' })
    backupDatabase('manual-sync').catch(err => console.error('[Contracts] 手動同步備份失敗:', err))
    const updatedCache = getAllContractCache()
    return NextResponse.json(buildContractList(updatedCache, getAllManualLocks()))
  } catch (err) {
    console.error('[Contracts] 抓取失敗:', err)
    // Return cached data even if fetch fails
    if (cached.length > 0) {
      return NextResponse.json(buildContractList(cached, manualLocks))
    }
    return NextResponse.json({ error: '無法取得合約資料' }, { status: 500 })
  }
}

function buildContractList(
  cached: ReturnType<typeof getAllContractCache>,
  manualLocks: ReturnType<typeof getAllManualLocks>
): { contracts: Contract[] } {
  const notesMap = getLegalNotesMap()
  const contracts: Contract[] = cached.map(item => {
    const lock = manualLocks.get(item.grNumber)
    const status: ContractStatus = lock ? lock.status : item.status
    const daysStale = daysSince(item.lastEmailAt)

    return {
      grNumber: item.grNumber,
      game: item.game as GameType,
      partner: item.partner,
      subject: item.subject,
      appliedAt: item.appliedAt,
      lastEmailAt: item.lastEmailAt,
      status,
      isManuallyLocked: Boolean(lock),
      manualStatus: lock?.status,
      responsibleLegal: item.responsibleLegal || undefined,
      hasAuthorizationLetter: item.hasAuthorizationLetter,
      contractVersion: item.contractVersion || undefined,
      financeConfirmed: item.financeConfirmed,
      nextAction: item.nextAction || undefined,
      daysStale,
      summary: item.summary || undefined,
      description: item.description || undefined,
      contractType: item.contractType || undefined,
      exposureSeason: item.exposureSeason || undefined,
      ourProvisions: item.ourProvisions || undefined,
      theirProvisions: item.theirProvisions || undefined,
      sponsorAmountNTD: item.sponsorAmountNTD || undefined,
      sponsorAmountUSD: item.sponsorAmountUSD || undefined,
      cooperationPeriod: item.cooperationPeriod || undefined,
      responsiblePerson: item.responsiblePerson || undefined,
      legalProgressNote: item.legalProgressNote || undefined,
      sheetLinkMode: item.sheetLinkMode || 'auto',
      notes: (notesMap.get(item.grNumber) || []).map(n => ({
        content: n.content,
        author: n.author,
        createdAt: n.createdAt,
      })),
    }
  })

  return { contracts }
}
