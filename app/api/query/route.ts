import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { fetchThreadByGrNumber } from '@/lib/gmail'
import { analyzeContractThread } from '@/lib/claude'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  const body = await request.json() as { grNumber: string }
  const grNumber = (body.grNumber || '').toUpperCase().trim()

  if (!grNumber.match(/^GR\d{6}$/)) {
    return NextResponse.json({ error: '請輸入正確的合約編號格式，例如：GR001216' }, { status: 400 })
  }

  const thread = await fetchThreadByGrNumber(session.accessToken, grNumber).catch(() => null)

  if (!thread) {
    return NextResponse.json({ error: `找不到合約 ${grNumber} 的郵件記錄` }, { status: 404 })
  }

  const analysis = await analyzeContractThread(thread)

  return NextResponse.json({
    grNumber,
    subject: thread.subject,
    messageCount: thread.messages.length,
    lastEmailAt: thread.messages[thread.messages.length - 1]?.date || null,
    status: analysis.status,
    responsibleLegal: analysis.responsibleLegal,
    hasAuthorizationLetter: analysis.hasAuthorizationLetter,
    contractVersion: analysis.contractVersion,
    financeConfirmed: analysis.financeConfirmed,
    nextAction: analysis.nextAction,
    summary: analysis.summary,
    timeline: analysis.timeline,
  })
}
