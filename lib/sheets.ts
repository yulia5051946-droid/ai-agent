import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import type { SheetContractData, GameType } from '@/types'

function loadAliases(): Record<string, string> {
  try {
    const p = path.join(process.cwd(), 'data', 'company-aliases.json')
    const raw = fs.readFileSync(p, 'utf-8')
    const obj = JSON.parse(raw) as Record<string, string>
    // Remove comment key
    delete obj['_comment']
    return obj
  } catch {
    return {}
  }
}

const SHEETS_CONFIG = {
  AOV: {
    spreadsheetId: '1l3sfmgYJhxY63sJ---5-FDFtknrm9L6rV4PVqZUXShU',
    gid: 910201431,
    game: 'AOV' as GameType,
  },
  DF: {
    spreadsheetId: '1WK-0O-dGgKN4lBuJTYwb3Ub-II-K3m6agvCp-RRAe1U',
    gid: 1557056712,
    game: 'DF' as GameType,
  },
  CODM: {
    spreadsheetId: '1LVRay_L996p50IAtsg8uPJU-HUceKB8-lrU-WkS_pW0',
    gid: 1557056712,
    game: 'CODM' as GameType,
  },
}

function createSheetsClient(accessToken: string) {
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })
  return google.sheets({ version: 'v4', auth })
}

export async function fetchAllSheetData(accessToken: string): Promise<Map<string, SheetContractData[]>> {
  const results = new Map<string, SheetContractData[]>()

  await Promise.all(
    Object.entries(SHEETS_CONFIG).map(async ([, config]) => {
      try {
        const data = await fetchGameSheetData(accessToken, config)
        for (const [key, rows] of data.entries()) {
          const existing = results.get(key) || []
          results.set(key, [...existing, ...rows])
        }
      } catch (err) {
        console.error(`[Sheets] ${config.game} 讀取失敗:`, String(err))
      }
    })
  )

  return results
}

export async function fetchGameSheetData(
  accessToken: string,
  config: typeof SHEETS_CONFIG[keyof typeof SHEETS_CONFIG]
): Promise<Map<string, SheetContractData[]>> {
  const sheets = createSheetsClient(accessToken)
  const map = new Map<string, SheetContractData[]>()

  // Resolve sheet tab name from gid
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId })
  const allSheets = meta.data.sheets || []
  let sheetMeta = allSheets.find(s => s.properties?.sheetId === config.gid)

  if (!sheetMeta) {
    const available = allSheets.map(s => `${s.properties?.title}(gid=${s.properties?.sheetId})`).join(', ')
    console.warn(`[Sheets] ${config.game} 找不到 gid=${config.gid}，可用頁籤：${available}`)
    // Fallback: 找最後一個非隱藏頁籤（通常是最新賽季）
    const visibleSheets = allSheets.filter(s => !s.properties?.hidden)
    sheetMeta = visibleSheets[visibleSheets.length - 1]
    if (sheetMeta) {
      console.warn(`[Sheets] ${config.game} 自動改用頁籤「${sheetMeta.properties?.title}」（gid=${sheetMeta.properties?.sheetId}）`)
    } else {
      console.error(`[Sheets] ${config.game} 無可用頁籤，跳過`)
      return map
    }
  }

  const sheetTitle = sheetMeta.properties?.title
  if (!sheetTitle) return map

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${sheetTitle}!A:Z`,
  })

  const rows = res.data.values || []
  if (rows.length < 2) return map

  const headers = rows[0].map((h: string) => String(h).trim())
  console.log(`[Sheets] ${config.game} 頁籤「${sheetTitle}」欄位：`, headers.join(' | '))
  console.log(`[Sheets] ${config.game} 共 ${rows.length - 1} 筆資料`)

  // Find GR 編號 column index (-1 if not present)
  const grColIdx = headers.findIndex(h => /GR|GR.?編號|GR.?number/i.test(h))

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    // Normalize spaces when matching (e.g. "贊助金額 (NTD)" vs "贊助金額(NTD)")
    const normalize = (s: string) => s.replace(/\s/g, '').toLowerCase()
    const get = (keyword: string): string => {
      const nk = normalize(keyword)
      const idx = headers.findIndex(h => normalize(h).includes(nk))
      return idx >= 0 ? String(row[idx] || '').trim() : ''
    }

    const partner = get('合作對象')
    if (!partner) continue

    const company = get('公司') || undefined

    // AOV-specific field names vs DF/CODM
    const isAOV = config.game === 'AOV'
    const sponsorAmountNTD = get(isAOV ? '贊助金額(NTD)' : '價值對標(NTD)')
    const sponsorAmountUSD = get(isAOV ? '贊助金額(USD)' : '價值對標(USD)')
    const cooperationPeriod = get('合作時間')
    const exposureSeason = get('露出賽季') || get('賽季') || get('Season') || ''

    const data: SheetContractData = {
      partner,
      company,
      description: get('內容簡述'),
      type: get('類型'),
      cooperationPeriod,
      exposureSeason,
      ourProvisions: get('我方提供'),
      theirProvisions: get('對方提供'),
      sponsorAmountNTD: sponsorAmountNTD || undefined,
      sponsorAmountUSD: sponsorAmountUSD || undefined,
      responsiblePerson: get('負責人'),
      game: config.game,
      // Internal metadata for GR↔sheet row linkage
      _rowIndex: i + 1,  // header is row 1, data row i → spreadsheet row i+1
      _spreadsheetId: config.spreadsheetId,
      _sheetTitle: sheetTitle,
      _grLinked: grColIdx >= 0 ? (String(row[grColIdx] || '').trim() || null) : undefined,
    }

    // 用 partner（品牌名）和 company（公司名）都當 key 建立索引
    const existing = map.get(partner) || []
    map.set(partner, [...existing, data])
    if (company && company !== partner) {
      const existingByCompany = map.get(company) || []
      map.set(company, [...existingByCompany, data])
    }
  }

  return map
}

export function matchSheetData(
  partner: string,
  allSheetData: Map<string, SheetContractData[]>,
  emailDescription?: string | null,
  grNumber?: string | null,
): SheetContractData | null {
  if (!partner && !emailDescription) return null

  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-（）()]/g, '')

  // 0. GR 編號精準比對（最高優先）
  if (grNumber) {
    const grUpper = grNumber.toUpperCase()
    for (const [, rows] of allSheetData.entries()) {
      const exact = rows.find(r => r._grLinked && r._grLinked.toUpperCase() === grUpper)
      if (exact) return exact
    }
  }

  // 候選清單取得後，用描述相似度選最佳一筆
  // 同時過濾掉已被其他 GR 認領的列（_grLinked 為其他 GR 號）
  const pickBest = (candidates: SheetContractData[]): SheetContractData => {
    // 排除已被其他合約明確認領的列
    const available = grNumber
      ? candidates.filter(r => !r._grLinked || r._grLinked.toUpperCase() === grNumber.toUpperCase())
      : candidates
    const pool = available.length > 0 ? available : candidates  // fallback to all if none available
    if (pool.length === 1 || !emailDescription) return pool[0]
    let best = pool[0]
    let bestScore = descScore(best.description, emailDescription)
    for (let i = 1; i < pool.length; i++) {
      const s = descScore(pool[i].description, emailDescription)
      if (s > bestScore) { bestScore = s; best = pool[i] }
    }
    return best
  }

  // 1. 公司名精確比對（最高優先，直接命中 email subject 的合作對象）
  if (partner) {
    for (const [, rows] of allSheetData.entries()) {
      const byCompany = rows.filter(r => r.company && norm(r.company) === norm(partner))
      if (byCompany.length > 0) return pickBest(byCompany)
    }
  }

  // 2. Exact partner（品牌名）match
  if (partner && allSheetData.has(partner)) return pickBest(allSheetData.get(partner)!)

  // 3. Alias table lookup
  if (partner) {
    const aliases = loadAliases()
    const aliasTarget = aliases[partner]
    if (aliasTarget) {
      for (const [key, rows] of allSheetData.entries()) {
        if (norm(key).includes(norm(aliasTarget)) || norm(aliasTarget).includes(norm(key))) return pickBest(rows)
      }
    }
  }

  // 4. Substring match on partner 或 company
  if (partner) {
    for (const [key, rows] of allSheetData.entries()) {
      if (key.includes(partner) || partner.includes(key)) return pickBest(rows)
      const byCompany = rows.filter(r => r.company && (r.company.includes(partner) || partner.includes(r.company)))
      if (byCompany.length > 0) return pickBest(byCompany)
    }
  }

  // 5. Strip legal suffixes and retry（partner + company）
  if (partner) {
    const stripped = stripCompanySuffix(partner)
    if (stripped.length >= 2) {
      for (const [key, rows] of allSheetData.entries()) {
        const strippedKey = stripCompanySuffix(key)
        if (strippedKey && (strippedKey.includes(stripped) || stripped.includes(strippedKey))) return pickBest(rows)
        const byCompany = rows.filter(r => {
          if (!r.company) return false
          const sc = stripCompanySuffix(r.company)
          return sc.length >= 2 && (sc.includes(stripped) || stripped.includes(sc))
        })
        if (byCompany.length > 0) return pickBest(byCompany)
      }
    }
  }

  // 6. Cross-match by description keywords — 要求至少 2 個關鍵字命中
  if (emailDescription) {
    const keywords = extractKeywords(emailDescription).filter(k => k.length >= 3)
    let bestCandidate: SheetContractData | null = null
    let bestHits = 1
    for (const [, rows] of allSheetData.entries()) {
      for (const row of rows) {
        const sheetText = norm((row.company || '') + ' ' + row.partner + ' ' + row.description)
        const hits = keywords.filter(k => sheetText.includes(norm(k))).length
        if (hits > bestHits) { bestHits = hits; bestCandidate = row }
      }
    }
    if (bestCandidate) return bestCandidate
  }

  return null
}

// Jaccard-like 描述相似度（0~1）
function descScore(sheetDesc: string, emailDesc: string): number {
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[（）()_\-x×、，。！？\s]+/g, ' ').split(' ').filter(t => t.length >= 2)
  const sheetTokens = new Set(tokenize(sheetDesc))
  const emailTokens = tokenize(emailDesc)
  if (sheetTokens.size === 0 || emailTokens.length === 0) return 0
  const hits = emailTokens.filter(t => sheetTokens.has(t)).length
  return hits / Math.max(sheetTokens.size, emailTokens.length)
}

function extractKeywords(text: string): string[] {
  // Split on common separators, keep tokens with at least 2 chars
  return text
    .split(/[\s_\-\/（）()　]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2)
}

function stripCompanySuffix(name: string): string {
  return name
    .replace(/股份有限公司|有限公司|股份公司|分公司|台灣分公司|台北分公司|日商|美商|韓商|英商/g, '')
    .replace(/\s+/g, '')
    .trim()
}

// Convert 0-based column index to A1 letter (0→A, 25→Z, 26→AA, etc.)
function colIndexToLetter(idx: number): string {
  let result = ''
  let n = idx + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

export async function writeGrNumberToSheet(
  accessToken: string,
  matched: SheetContractData,
  grNumber: string,
): Promise<void> {
  // Only proceed if we have the metadata and the row doesn't already have this GR
  if (!matched._spreadsheetId || !matched._sheetTitle || matched._rowIndex === undefined) return
  if (matched._grLinked === grNumber) return  // already correct, skip
  if (matched._grLinked && matched._grLinked !== grNumber) return  // belongs to another GR, don't overwrite

  const sheets = createSheetsClient(accessToken)
  const spreadsheetId = matched._spreadsheetId
  const sheetTitle = matched._sheetTitle
  const rowIndex = matched._rowIndex  // already the spreadsheet row number (1-based, accounting for header)

  try {
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetTitle}!1:1`,
    })
    const headers = (headerRes.data.values?.[0] || []).map(String)
    let grColIdx = headers.findIndex(h => /GR|GR.?編號|GR.?number/i.test(h))

    if (grColIdx < 0) {
      // No GR column — append one at the end
      grColIdx = headers.length  // 0-based index for the new column
      const colLetter = colIndexToLetter(grColIdx)
      // Write header
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetTitle}!${colLetter}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['GR 編號']] },
      })
    }

    // Write GR number to the matched row
    const colLetter = colIndexToLetter(grColIdx)
    const cellRange = `${sheetTitle}!${colLetter}${rowIndex}`
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: cellRange,
      valueInputOption: 'RAW',
      requestBody: { values: [[grNumber]] },
    })
    console.log(`[Sheets] 回寫 GR ${grNumber} → ${sheetTitle} 第 ${rowIndex} 列 ${colLetter}${rowIndex}`)
  } catch (err) {
    console.error('[Sheets] 回寫 GR 失敗:', String(err))
  }
}
