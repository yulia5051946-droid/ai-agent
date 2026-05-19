import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getAllContractCache, getAllManualLocks, getLegalNotesMap } from '@/lib/db'
import { exportContractsToSheet } from '@/lib/export-sheet'
import type { ContractStatus } from '@/types'

export async function POST() {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  const cached = getAllContractCache()
  const manualLocks = getAllManualLocks()
  const notesMap = getLegalNotesMap()

  const contracts = cached.map(item => {
    const lock = manualLocks.get(item.grNumber)
    const status: ContractStatus = lock ? lock.status : item.status
    const notes = (notesMap.get(item.grNumber) || []).map(n => ({
      content: n.content,
      createdAt: n.createdAt,
    }))

    return {
      grNumber: item.grNumber,
      game: item.game,
      appliedAt: item.appliedAt,
      responsibleLegal: item.responsibleLegal || undefined,
      status,
      partner: item.partner,
      cooperationPeriod: item.cooperationPeriod || undefined,
      description: item.description || undefined,
      contractType: item.contractType || undefined,
      responsiblePerson: item.responsiblePerson || undefined,
      exposureSeason: item.exposureSeason || undefined,
      sponsorAmountNTD: item.sponsorAmountNTD || undefined,
      ourProvisions: item.ourProvisions || undefined,
      theirProvisions: item.theirProvisions || undefined,
      nextAction: item.nextAction || undefined,
      legalProgressNote: item.legalProgressNote || undefined,
      contractVersion: item.contractVersion || undefined,
      hasAuthorizationLetter: item.hasAuthorizationLetter,
      lastEmailAt: item.lastEmailAt,
      notes,
    }
  })

  try {
    const result = await exportContractsToSheet(session.accessToken, contracts)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[ExportSheet] 匯出失敗:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
