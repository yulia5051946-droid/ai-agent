import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import nodemailer from 'nodemailer'
import { getAllContractCache, getAllManualLocks } from '@/lib/db'
import { generateDailyReportContent } from '@/lib/claude'
import type { ContractStatus } from '@/types'

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

export async function POST(request: Request) {
  // Allow cron secret or user session
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    const session = await auth()
    if (!session?.accessToken) {
      return NextResponse.json({ error: '未授權' }, { status: 401 })
    }
  }

  const cacheItems = getAllContractCache()
  const manualLocks = getAllManualLocks()

  const contracts = cacheItems.map(item => {
    const lock = manualLocks.get(item.grNumber)
    return {
      grNumber: item.grNumber,
      partner: item.partner,
      status: (lock ? lock.status : item.status) as ContractStatus,
      lastEmailAt: item.lastEmailAt,
      daysStale: daysSince(item.lastEmailAt),
      nextAction: item.nextAction,
    }
  })

  const content = await generateDailyReportContent(contracts)

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  const recipients = (process.env.DAILY_REPORT_TO || 'liny@garena.com,chenla@garena.com')
    .split(',')
    .map(e => e.trim())

  const today = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: recipients.join(', '),
    subject: `【合約日報】${today} Garena BD 合約追蹤`,
    text: content,
    html: `<pre style="font-family:monospace;font-size:14px;line-height:1.6">${content}</pre>`,
  })

  return NextResponse.json({ success: true, sentTo: recipients, contractCount: contracts.length })
}
