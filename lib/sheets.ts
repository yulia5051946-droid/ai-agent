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
  const sheetMeta = meta.data.sheets?.find(s => s.properties?.sheetId === config.gid)
  const sheetTitle = sheetMeta?.properties?.title
  if (!sheetTitle) {
    const available = meta.data.sheets?.map(s => `${s.properties?.title}(gid=${s.properties?.sheetId})`).join(', ')
    console.error(`[Sheets] ${config.game} 找不到 gid=${config.gid}，可用頁籤：${available}`)
    return map
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${sheetTitle}!A:Z`,
  })

  const rows = res.data.values || []
  if (rows.length < 2) return map

  const headers = rows[0].map((h: string) => String(h).trim())
  console.log(`[Sheets] ${config.game} 頁籤「${sheetTitle}」欄位：`, headers.join(' | '))
  console.log(`[Sheets] ${config.game} 共 ${rows.length - 1} 筆資料`)

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
  emailDescription?: string | null
): SheetContractData | null {
  if (!partner && !emailDescription) return null

  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-（）()]/g, '')

  // 候選清單取得後，用描述相似度選最佳一筆
  const pickBest = (candidates: SheetContractData[]): SheetContractData => {
    if (candidates.length === 1 || !emailDescription) return candidates[0]
    let best = candidates[0]
    let bestScore = descScore(best.description, emailDescription)
    for (let i = 1; i < candidates.length; i++) {
      const s = descScore(candidates[i].description, emailDescription)
      if (s > bestScore) { bestScore = s; best = candidates[i] }
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
