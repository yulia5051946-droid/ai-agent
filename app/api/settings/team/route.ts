import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getAllTeamMembers, addTeamMember, updateTeamMember, deleteTeamMember } from '@/lib/db'
import type { TeamMember } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })
  return NextResponse.json({ members: getAllTeamMembers() })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })
  const { email, displayName, role } = await request.json()
  if (!email || !displayName || !role) return NextResponse.json({ error: '缺少欄位' }, { status: 400 })
  try {
    const member = addTeamMember(email.toLowerCase().trim(), displayName.trim(), role as TeamMember['role'])
    return NextResponse.json({ member })
  } catch {
    return NextResponse.json({ error: '此 email 已存在' }, { status: 409 })
  }
}

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })
  const { id, email, displayName, role } = await request.json()
  updateTeamMember(id, email.toLowerCase().trim(), displayName.trim(), role as TeamMember['role'])
  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })
  const { id } = await request.json()
  deleteTeamMember(id)
  return NextResponse.json({ success: true })
}
