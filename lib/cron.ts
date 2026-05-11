import cron from 'node-cron'
import nodemailer from 'nodemailer'
import { getAllContractCache, getAllManualLocks, getLegalNotesMap } from './db'
import type { ContractStatus } from '@/types'

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function fmt(date: string | null | undefined): string {
  if (!date) return '-'
  try { return new Date(date).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) } catch { return '-' }
}

function statusColor(status: string): string {
  if (status === '合約取消') return '#9ca3af'
  if (status === '合約完成') return '#16a34a'
  if (status === '已提供最終清稿待用印') return '#0d9488'
  if (status === '確定法務負責人') return '#2563eb'
  if (status === '待財務確認') return '#7c3aed'
  if (status.startsWith('法務已提供')) return '#4338ca'
  if (status.startsWith('已提供')) return '#d97706'
  if (status.startsWith('品牌已反饋')) return '#0891b2'
  return '#ea580c'
}

function buildWeeklyReportHtml(
  contracts: {
    grNumber: string
    partner: string
    status: string
    responsibleLegal?: string | null
    lastEmailAt: string | null
    daysStale: number
    nextAction?: string | null
    latestNote?: string
  }[]
): string {
  const active = contracts.filter(c => !['合約取消', '合約完成'].includes(c.status))
  const overdue = active.filter(c => c.daysStale >= 14)
  const warning = active.filter(c => c.daysStale >= 7 && c.daysStale < 14)

  const weekStr = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const rowBg = (i: number) => i % 2 === 0 ? '#ffffff' : '#f9fafb'

  function contractTable(list: typeof contracts, title: string, accent: string): string {
    if (list.length === 0) return ''
    const rows = list.map((c, i) => `
      <tr style="background:${rowBg(i)}">
        <td style="padding:8px 12px;font-family:monospace;font-weight:600;color:#ea580c;white-space:nowrap">${c.grNumber}</td>
        <td style="padding:8px 12px;white-space:nowrap">${c.partner}</td>
        <td style="padding:8px 12px">
          <span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;background:${statusColor(c.status)}1a;color:${statusColor(c.status)};font-weight:500;white-space:nowrap">${c.status}</span>
        </td>
        <td style="padding:8px 12px;white-space:nowrap;color:#6b7280">${c.responsibleLegal || '-'}</td>
        <td style="padding:8px 12px;white-space:nowrap;color:#6b7280">${fmt(c.lastEmailAt)}</td>
        <td style="padding:8px 12px;white-space:nowrap;color:${c.daysStale >= 14 ? '#dc2626' : c.daysStale >= 7 ? '#d97706' : '#6b7280'};font-weight:${c.daysStale >= 7 ? '600' : '400'}">${c.daysStale >= 999 ? '未知' : `${c.daysStale} 天`}</td>
        <td style="padding:8px 12px;color:#374151;max-width:240px">${c.nextAction || c.latestNote || '-'}</td>
      </tr>`).join('')

    return `
      <h3 style="margin:24px 0 8px;font-size:15px;color:${accent};border-left:4px solid ${accent};padding-left:8px">${title}（${list.length} 份）</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;white-space:nowrap">GR 編號</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;white-space:nowrap">合作對象</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;white-space:nowrap">合約狀態</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;white-space:nowrap">負責法務</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;white-space:nowrap">最新郵件</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;white-space:nowrap">停滯天數</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151">下一步行動</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:900px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,0.08)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#ea580c,#dc2626);padding:28px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">Garena BD 合約週報</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px">${weekStr} 製作</p>
    </div>

    <!-- Summary cards -->
    <div style="display:flex;gap:16px;padding:24px 32px 0;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 20px">
        <p style="margin:0;font-size:28px;font-weight:700;color:#ea580c">${active.length}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#9a3412">進行中合約</p>
      </div>
      <div style="flex:1;min-width:140px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px">
        <p style="margin:0;font-size:28px;font-weight:700;color:#dc2626">${overdue.length}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#991b1b">逾期（14 天+）</p>
      </div>
      <div style="flex:1;min-width:140px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px">
        <p style="margin:0;font-size:28px;font-weight:700;color:#d97706">${warning.length}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#92400e">注意（7–13 天）</p>
      </div>
    </div>

    <!-- Contract tables -->
    <div style="padding:8px 32px 32px">
      ${contractTable(overdue, '逾期合約', '#dc2626')}
      ${contractTable(warning, '注意合約', '#d97706')}
      ${contractTable(active.filter(c => c.daysStale < 7), '正常進行中', '#16a34a')}
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
      <p style="margin:0;font-size:12px;color:#9ca3af">由 Garena BD 合約追蹤系統自動產生 · 每週一 09:00 發送</p>
    </div>
  </div>
</body>
</html>`
}

async function sendWeeklyReport() {
  console.log('[Cron] 開始產生每週週報...')

  const cacheItems = getAllContractCache()
  const manualLocks = getAllManualLocks()
  const notesMap = getLegalNotesMap()

  const contracts = cacheItems.map(item => {
    const lock = manualLocks.get(item.grNumber)
    const status: ContractStatus = lock ? lock.status : item.status
    const daysStale = daysSince(item.lastEmailAt)
    const notes = notesMap.get(item.grNumber) || []
    const latestNote = notes.length > 0 ? notes[notes.length - 1].content : undefined

    return {
      grNumber: item.grNumber,
      partner: item.partner,
      status,
      responsibleLegal: item.responsibleLegal,
      lastEmailAt: item.lastEmailAt,
      daysStale,
      nextAction: item.nextAction,
      latestNote,
    }
  })

  const html = buildWeeklyReportHtml(contracts)

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  const recipients = (process.env.DAILY_REPORT_TO || 'liny@garena.com')
    .split(',')
    .map(e => e.trim())

  const weekStr = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: recipients.join(', '),
    subject: `【合約週報】${weekStr} Garena BD 合約追蹤`,
    html,
  })

  console.log(`[Cron] 週報已寄送至 ${recipients.join(', ')}`)
}

export function initCron() {
  // 每週一早上 9 點（台灣時間）
  cron.schedule('0 9 * * 1', async () => {
    try {
      await sendWeeklyReport()
    } catch (err) {
      console.error('[Cron] 週報發送失敗:', err)
    }
  }, {
    timezone: 'Asia/Taipei',
  })

  console.log('[Cron] 每週週報排程已啟動（每週一台灣時間 09:00）')
}
