import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { fetchAllSheetData, writeGrNumberToSheet } from '@/lib/sheets'
import { getContractCache, setAutoSheetLinkMode, setManualResourceData } from '@/lib/db'
import type { SheetContractData } from '@/types'

// rowKey 格式：spreadsheetId::sheetTitle::rowIndex
function encodeRowKey(row: SheetContractData): string | null {
  if (!row._spreadsheetId || !row._sheetTitle || row._rowIndex === undefined) return null
  return `${row._spreadsheetId}::${row._sheetTitle}::${row._rowIndex}`
}

function decodeRowKey(key: string): { spreadsheetId: string; sheetTitle: string; rowIndex: number } | null {
  const parts = key.split('::')
  if (parts.length < 3) return null
  const rowIndex = parseInt(parts[parts.length - 1])
  const sheetTitle = parts.slice(1, -1).join('::')
  const spreadsheetId = parts[0]
  if (isNaN(rowIndex)) return null
  return { spreadsheetId, sheetTitle, rowIndex }
}

// GET /api/contracts/[id]/sheet-link
// 返回所有可選的 Sheet 列（供使用者手動挑選）
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

  let allSheetData: Map<string, SheetContractData[]>
  try {
    allSheetData = await fetchAllSheetData(session.accessToken)
  } catch {
    return NextResponse.json({ error: '無法讀取試算表' }, { status: 500 })
  }

  // 收集所有 sheet 列（平鋪），產生 rowKey，去重
  const seen = new Set<string>()
  const candidates: {
    rowKey: string
    partner: string
    description: string
    type: string
    game: string
    exposureSeason: string
    cooperationPeriod: string
    responsiblePerson: string
    currentGr: string | null
    isLinkedToThis: boolean
  }[] = []

  for (const rows of allSheetData.values()) {
    for (const row of rows) {
      const key = encodeRowKey(row)
      if (!key || seen.has(key)) continue
      seen.add(key)
      candidates.push({
        rowKey: key,
        partner: row.partner,
        description: row.description,
        type: row.type,
        game: row.game,
        exposureSeason: row.exposureSeason,
        cooperationPeriod: row.cooperationPeriod,
        responsiblePerson: row.responsiblePerson,
        currentGr: row._grLinked ?? null,
        isLinkedToThis: row._grLinked?.toUpperCase() === grNumber,
      })
    }
  }

  // 優先顯示：同遊戲、尚未被其他 GR 認領、或已連結到本合約
  const cached = getContractCache(grNumber)
  const contractGame = cached?.game || 'unknown'

  candidates.sort((a, b) => {
    const aLinked = a.isLinkedToThis ? -2 : (a.currentGr ? 1 : 0)
    const bLinked = b.isLinkedToThis ? -2 : (b.currentGr ? 1 : 0)
    if (aLinked !== bLinked) return aLinked - bLinked
    const aGame = a.game === contractGame ? -1 : 0
    const bGame = b.game === contractGame ? -1 : 0
    return aGame - bGame
  })

  return NextResponse.json({
    candidates,
    contractGame,
    sheetLinkMode: cached?.sheetLinkMode || 'auto',
    manualData: cached ? {
      description: cached.description,
      contractType: cached.contractType,
      exposureSeason: cached.exposureSeason,
      ourProvisions: cached.ourProvisions,
      theirProvisions: cached.theirProvisions,
      sponsorAmountNTD: cached.sponsorAmountNTD,
      sponsorAmountUSD: cached.sponsorAmountUSD,
      cooperationPeriod: cached.cooperationPeriod,
      responsiblePerson: cached.responsiblePerson,
    } : null,
  })
}

// POST /api/contracts/[id]/sheet-link
// body: { rowKey: string } → 強制把這個合約的 GR 寫到指定 sheet 列
// body: { action: 'manual', data: {...} } → 不連結 Sheet，改用手動資源內容
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  const { id } = await params
  const grNumber = id.toUpperCase()

  const body = await request.json() as {
    rowKey?: string
    action?: 'manual'
    data?: {
      description?: string
      contractType?: string
      exposureSeason?: string
      ourProvisions?: string
      theirProvisions?: string
      sponsorAmountNTD?: string
      sponsorAmountUSD?: string
      cooperationPeriod?: string
      responsiblePerson?: string
    }
  }

  if (body.action === 'manual') {
    const data = body.data || {}
    const clean = (value: string | undefined) => {
      const trimmed = value?.trim()
      return trimmed ? trimmed : null
    }
    try {
      setManualResourceData(grNumber, {
        description: clean(data.description),
        contractType: clean(data.contractType),
        exposureSeason: clean(data.exposureSeason),
        ourProvisions: clean(data.ourProvisions),
        theirProvisions: clean(data.theirProvisions),
        sponsorAmountNTD: clean(data.sponsorAmountNTD),
        sponsorAmountUSD: clean(data.sponsorAmountUSD),
        cooperationPeriod: clean(data.cooperationPeriod),
        responsiblePerson: clean(data.responsiblePerson),
      })
      return NextResponse.json({ success: true, grNumber, sheetLinkMode: 'manual' })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  if (!body.rowKey) {
    return NextResponse.json({ error: '缺少 rowKey' }, { status: 400 })
  }

  const decoded = decodeRowKey(body.rowKey)
  if (!decoded) {
    return NextResponse.json({ error: '無效的 rowKey' }, { status: 400 })
  }

  // 建一個假的 SheetContractData，只帶必要的 metadata，強制寫入
  // （_grLinked 設為 null，讓 writeGrNumberToSheet 允許寫入，即使目前有其他 GR）
  const fakeRow: SheetContractData = {
    partner: '', description: '', type: '', cooperationPeriod: '',
    exposureSeason: '', ourProvisions: '', theirProvisions: '', responsiblePerson: '',
    game: 'unknown',
    _spreadsheetId: decoded.spreadsheetId,
    _sheetTitle: decoded.sheetTitle,
    _rowIndex: decoded.rowIndex,
    _grLinked: null,  // 強制允許寫入
  }

  try {
    await writeGrNumberToSheet(session.accessToken, fakeRow, grNumber)
    setAutoSheetLinkMode(grNumber)
    return NextResponse.json({ success: true, grNumber, rowKey: body.rowKey })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
