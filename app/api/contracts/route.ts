import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchContractThreads, fetchInvoiceEmails, extractLatestContractVersion, extractAppliedDate, detectFinanceInfo } from '@/lib/gmail'
import { analyzeContractThread, extractDescription } from '@/lib/claude'
import { upsertContractCache, getAllContractCache, getAllManualLocks, upsertInvoiceRecord, getLegalNotesMap, getAllTeamMembers } from '@/lib/db'
import { fetchAllSheetData, matchSheetData } from '@/lib/sheets'
import type { Contract, ContractStatus, GameType } from '@/types'

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function detectGame(subject: string): GameType {
  if (/AOV|傳說對決|Arena of Valor/i.test(subject)) return 'AOV'
  if (/DF|決鬥|Undawn/i.test(subject)) return 'DF'
  if (/CODM|使命召喚/i.test(subject)) return 'CODM'
  return 'unknown'
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('refresh') === 'true'

  // Check if we have recent cached data
  const cached = getAllContractCache()
  const manualLocks = getAllManualLocks()

  if (!forceRefresh && cached.length > 0) {
    const mostRecentUpdate = cached.reduce((latest, c) => {
      return new Date(c.updatedAt) > new Date(latest) ? c.updatedAt : latest
    }, cached[0].updatedAt)

    const age = Date.now() - new Date(mostRecentUpdate).getTime()
    if (age < CACHE_TTL_MS) {
      return NextResponse.json(buildContractList(cached, manualLocks))
    }
  }

  // Fetch fresh data from Gmail
  try {
    const [threads, invoiceMap, allSheetData] = await Promise.all([
      fetchContractThreads(session.accessToken),
      fetchInvoiceEmails(session.accessToken).catch(() => new Map()),
      fetchAllSheetData(session.accessToken).catch(() => new Map<string, SheetContractData>()),
    ])

    const sheetTotal = Array.from(allSheetData.values()).reduce((s, rows) => s + rows.length, 0)
    console.log(`[Contracts] 找到 ${threads.length} 個 thread，Sheet 資料 ${sheetTotal} 筆（${allSheetData.size} 家廠商）`)
    threads.forEach(t => {
      const partner = extractPartnerFromSubject(t.subject)
      const desc = extractDescription(t.subject)
      const game = detectGame(t.subject)
      const filtered = game !== 'unknown'
        ? new Map([...allSheetData.entries()].filter(([, rows]) => rows.some(r => r.game === game)))
        : allSheetData
      const matched = matchSheetData(partner, filtered, desc)
      if (!matched) console.log(`[Sheets] 未比對 ${t.grNumber}(${game}): 廠商「${partner}」`)
      else console.log(`[Sheets] 比對到 ${t.grNumber}(${game}): 廠商「${partner}」→「${matched.partner}」`)
    })

    // Update invoice records
    for (const [grNumber, invoice] of invoiceMap.entries()) {
      upsertInvoiceRecord({
        grNumber,
        appliedAt: invoice.appliedAt,
        issuedAt: null,
        amount: invoice.amount,
        updatedAt: new Date().toISOString(),
      })
    }

    const teamMembers = getAllTeamMembers()
    // Analyze threads with Claude (batch with rate limit awareness)
    console.log(`[Contracts] 開始分析 ${threads.length} 份合約`)
    const analysisResults = await Promise.allSettled(
      threads.map(async thread => {
        try {
          const analysis = await analyzeContractThread(thread, teamMembers)
          const lastMsg = thread.messages[thread.messages.length - 1]
          const contractVersion = extractLatestContractVersion(thread.messages)
          const appliedAt = extractAppliedDate(thread.messages)
          const financeInfo = detectFinanceInfo(thread.messages)

          const partner = extractPartnerFromSubject(thread.subject)
          const emailDesc = extractDescription(thread.subject)
          const existingCache = cached.find(c => c.grNumber === thread.grNumber)

          // 只在該合約所屬遊戲的 Sheet 資料中比對，避免跨遊戲誤抓
          const detectedGame = detectGame(thread.subject)
          const gameSheetData = detectedGame !== 'unknown'
            ? new Map([...allSheetData.entries()].filter(([, rows]) => rows.some(r => r.game === detectedGame)))
            : allSheetData
          const sheetData = matchSheetData(partner, gameSheetData, emailDesc)

          const TERMINAL_STATUSES: ContractStatus[] = ['合約取消', '合約完成']
          const cachedStatus = existingCache?.status as ContractStatus | undefined
          const finalStatus = (cachedStatus && TERMINAL_STATUSES.includes(cachedStatus))
            ? cachedStatus
            : analysis.status

          console.log(`[Status] ${thread.grNumber}: cache="${cachedStatus}" ai="${analysis.status}" final="${finalStatus}"`)
          upsertContractCache({
            grNumber: thread.grNumber,
            threadId: thread.threadId,
            game: (sheetData?.game) || detectGame(thread.subject),
            gameManual: existingCache?.gameManual ?? false,
            partner,
            subject: thread.subject,
            appliedAt,
            lastEmailAt: lastMsg?.date || null,
            status: finalStatus,
            responsibleLegal: analysis.responsibleLegal,
            hasAuthorizationLetter: analysis.hasAuthorizationLetter,
            contractVersion: contractVersion || analysis.contractVersion,
            financeConfirmed: analysis.financeConfirmed || financeInfo.confirmed,
            nextAction: analysis.nextAction,
            summary: analysis.summary,
            updatedAt: new Date().toISOString(),
            // 以下欄位只從 Sheet 取，沒比對到就留空
            description: sheetData?.description || null,
            contractType: sheetData?.type || null,
            exposureSeason: sheetData?.exposureSeason || null,
            ourProvisions: sheetData?.ourProvisions || null,
            theirProvisions: sheetData?.theirProvisions || null,
            sponsorAmountNTD: sheetData?.sponsorAmountNTD || null,
            cooperationPeriod: sheetData?.cooperationPeriod || null,
            responsiblePerson: sheetData?.responsiblePerson || null,
            legalProgressNote: analysis.legalProgressNote,
          })

          return thread.grNumber
        } catch (err) {
          console.error(`[Contracts] 分析錯誤 ${thread.grNumber}:`, String(err))
          throw err
        }
      })
    )

    const succeeded = analysisResults.filter(r => r.status === 'fulfilled').length
    console.log(`[Contracts] 更新 ${succeeded}/${threads.length} 份合約`)
    if (succeeded === 0 && threads.length > 0) {
      const firstRejected = analysisResults.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
      console.error('[Contracts] 第一個錯誤:', String(firstRejected?.reason))
    }

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
      cooperationPeriod: item.cooperationPeriod || undefined,
      responsiblePerson: item.responsiblePerson || undefined,
      legalProgressNote: item.legalProgressNote || undefined,
      notes: (notesMap.get(item.grNumber) || []).map(n => ({
        content: n.content,
        author: n.author,
        createdAt: n.createdAt,
      })),
    }
  })

  return { contracts }
}

function extractPartnerFromSubject(subject: string): string {
  // Subject format: [合約審閱]MOBTW (競舞電競)_統一數網股份有限公司_傳說對決X 純喫茶 聯名合作 - GR000965
  const match = subject.match(/\[合約審閱\][^_]*_([^_]+)_/)
  return match ? match[1].trim() : subject.replace(/\[合約審閱\].*?[-–]\s*GR\d+/i, '').trim()
}
