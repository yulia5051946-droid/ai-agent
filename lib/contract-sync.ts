import {
  getAllContractCache,
  getAllTeamMembers,
  saveEmailTimeline,
  upsertContractCache,
  upsertInvoiceRecord,
} from '@/lib/db'
import { fetchContractThreads, fetchInvoiceEmails, extractLatestContractVersion, extractAppliedDate, detectFinanceInfo } from '@/lib/gmail'
import { analyzeContractThread, extractDescription } from '@/lib/claude'
import { fetchAllSheetData, filterSheetDataByGame, matchSheetData, writeGrNumberToSheet } from '@/lib/sheets'
import type { ContractStatus, GameType, SheetContractData } from '@/types'

const TERMINAL_STATUSES: ContractStatus[] = ['合約取消', '合約完成']

export interface ContractSyncResult {
  threads: number
  succeeded: number
  sheetRows: number
  source: string
}

export function detectGame(subject: string): GameType {
  if (/\bAOV\b|傳說對決|Arena of Valor/i.test(subject)) return 'AOV'
  if (/\bCODM\b|使命召喚/i.test(subject)) return 'CODM'
  if (/\bDF\b|決鬥|Undawn/i.test(subject)) return 'DF'
  return 'unknown'
}

export function extractPartnerFromSubject(subject: string): string {
  const match = subject.match(/\[合約審閱\][^_]*_([^_]+)_/)
  return match ? match[1].trim() : subject.replace(/\[合約審閱\].*?[-–]\s*GR\d+/i, '').trim()
}

export async function runContractSync(
  accessToken: string,
  options: { source?: string } = {}
): Promise<ContractSyncResult> {
  const source = options.source || 'manual'
  const cached = getAllContractCache()
  const [threads, invoiceMap, allSheetData] = await Promise.all([
    fetchContractThreads(accessToken),
    fetchInvoiceEmails(accessToken).catch(() => new Map()),
    fetchAllSheetData(accessToken).catch(() => new Map<string, SheetContractData[]>()),
  ])

  const sheetRows = Array.from(allSheetData.values()).reduce((sum, rows) => sum + rows.length, 0)
  console.log(`[Contracts:${source}] 找到 ${threads.length} 個 thread，Sheet 資料 ${sheetRows} 筆（${allSheetData.size} 家廠商）`)

  for (const thread of threads) {
    const partner = extractPartnerFromSubject(thread.subject)
    const desc = extractDescription(thread.subject)
    const game = detectGame(thread.subject)
    const filtered = filterSheetDataByGame(allSheetData, game)
    const matched = matchSheetData(partner, filtered, desc, thread.grNumber)
    if (!matched) console.log(`[Sheets] 未比對 ${thread.grNumber}(${game}): 廠商「${partner}」`)
    else console.log(`[Sheets] 比對到 ${thread.grNumber}(${game}): 廠商「${partner}」→「${matched.partner}」`)
  }

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
  console.log(`[Contracts:${source}] 開始分析 ${threads.length} 份合約`)
  const analysisResults = await Promise.allSettled(
    threads.map(async thread => {
      try {
        const analysis = await analyzeContractThread(thread, teamMembers)
        saveEmailTimeline(thread.grNumber, analysis.timeline)
        const lastMsg = thread.messages[thread.messages.length - 1]
        const contractVersion = extractLatestContractVersion(thread.messages)
        const appliedAt = extractAppliedDate(thread.messages)
        const financeInfo = detectFinanceInfo(thread.messages)

        const partner = extractPartnerFromSubject(thread.subject)
        const emailDesc = extractDescription(thread.subject)
        const existingCache = cached.find(c => c.grNumber === thread.grNumber)

        const gameManual = existingCache?.gameManual ?? false
        const detectedGame = detectGame(thread.subject)
        const effectiveGame: GameType = gameManual
          ? (existingCache!.game as GameType)
          : (detectedGame !== 'unknown' ? detectedGame : (existingCache?.game as GameType | undefined) ?? 'unknown')

        const gameSheetData = filterSheetDataByGame(allSheetData, effectiveGame)
        const sheetData = existingCache?.sheetLinkMode === 'manual'
          ? null
          : matchSheetData(partner, gameSheetData, emailDesc, thread.grNumber)

        if (sheetData && thread.grNumber && sheetData._grLinked !== thread.grNumber) {
          writeGrNumberToSheet(accessToken, sheetData, thread.grNumber).catch(err =>
            console.error(`[Sheets] ${thread.grNumber} 回寫失敗:`, String(err))
          )
        }

        const finalGame: GameType = gameManual
          ? (existingCache!.game as GameType)
          : ((sheetData?.game as GameType | undefined) ?? effectiveGame)

        const cachedStatus = existingCache?.status as ContractStatus | undefined
        const finalStatus = (cachedStatus && TERMINAL_STATUSES.includes(cachedStatus))
          ? cachedStatus
          : analysis.status

        console.log(`[Status] ${thread.grNumber}(${effectiveGame}): cache="${cachedStatus}" ai="${analysis.status}" final="${finalStatus}"`)
        upsertContractCache({
          grNumber: thread.grNumber,
          threadId: thread.threadId,
          game: finalGame,
          gameManual,
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

        return thread.grNumber
      } catch (err) {
        console.error(`[Contracts:${source}] 分析錯誤 ${thread.grNumber}:`, String(err))
        throw err
      }
    })
  )

  const succeeded = analysisResults.filter(r => r.status === 'fulfilled').length
  console.log(`[Contracts:${source}] 更新 ${succeeded}/${threads.length} 份合約`)
  if (succeeded === 0 && threads.length > 0) {
    const firstRejected = analysisResults.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    console.error(`[Contracts:${source}] 第一個錯誤:`, String(firstRejected?.reason))
  }

  return { threads: threads.length, succeeded, sheetRows, source }
}
