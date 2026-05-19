import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isBDMember } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  return NextResponse.json({
    email: session.user.email,
    isBD: isBDMember(session.user.email),
  })
}
