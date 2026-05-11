import { google } from 'googleapis'

const HEADERS = [
  'GR 編號', '遊戲', '申請日期', '負責法務', '合約狀態',
  '合作對象', '合作時間', '內容簡述', '類型', '負責人',
  '露出賽季', '贊助金額（NTD）', '我方提供', '對方提供',
  '下一步行動', '最新法務備註', '目前版本', '授權信',
  '最新郵件日期', '最後同步時間',
]

function fmt(date: string | null | undefined): string {
  if (!date) return ''
  try { return new Date(date).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) } catch { return '' }
}

export async function exportContractsToSheet(
  accessToken: string,
  contracts: {
    grNumber: string
    game: string
    appliedAt: string | null
    responsibleLegal?: string
    status: string
    partner: string
    cooperationPeriod?: string
    description?: string
    contractType?: string
    responsiblePerson?: string
    exposureSeason?: string
    sponsorAmountNTD?: string
    ourProvisions?: string
    theirProvisions?: string
    nextAction?: string
    legalProgressNote?: string
    contractVersion?: string
    hasAuthorizationLetter?: boolean
    lastEmailAt: string | null
    notes?: { content: string; createdAt: string }[]
  }[]
): Promise<{ spreadsheetId: string; url: string }> {
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })
  const sheets = google.sheets({ version: 'v4', auth })

  const spreadsheetId = process.env.EXPORT_SHEET_ID

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  const rows = contracts.map(c => [
    c.grNumber,
    c.game,
    fmt(c.appliedAt),
    c.responsibleLegal || '',
    c.status,
    c.partner,
    c.cooperationPeriod || '',
    c.description || '',
    c.contractType || '',
    c.responsiblePerson || '',
    c.exposureSeason || '',
    c.sponsorAmountNTD || '',
    c.ourProvisions || '',
    c.theirProvisions || '',
    c.nextAction || '',
    c.notes?.length ? c.notes[c.notes.length - 1].content : (c.legalProgressNote || ''),
    c.contractVersion || '',
    c.hasAuthorizationLetter === true ? '✓' : c.hasAuthorizationLetter === false ? '✗' : '',
    fmt(c.lastEmailAt),
    now,
  ])

  if (spreadsheetId) {
    // 寫入已有試算表
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS, ...rows] },
    })
    return {
      spreadsheetId,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    }
  } else {
    // 建立新試算表
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'Garena BD 合約追蹤匯出' },
        sheets: [{ properties: { title: '合約追蹤' } }],
      },
    })
    const newId = created.data.spreadsheetId!
    await sheets.spreadsheets.values.update({
      spreadsheetId: newId,
      range: '合約追蹤!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS, ...rows] },
    })
    return {
      spreadsheetId: newId,
      url: `https://docs.google.com/spreadsheets/d/${newId}`,
    }
  }
}
