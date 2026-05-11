import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLegalNotes, addLegalNote, deleteLegalNote } from '@/lib/db'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const notes = getLegalNotes(id.toUpperCase())
  return NextResponse.json({ notes })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as { content?: string }
  if (!body.content?.trim()) return NextResponse.json({ error: '備註內容不得為空' }, { status: 400 })

  const author = session.user?.email || session.user?.name || '未知使用者'
  const note = addLegalNote(id.toUpperCase(), body.content.trim(), author)
  return NextResponse.json({ note })
}

export async function DELETE(
  request: Request,
  { params: _params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const body = await request.json() as { noteId?: number }
  if (!body.noteId) return NextResponse.json({ error: '缺少 noteId' }, { status: 400 })

  deleteLegalNote(body.noteId)
  return NextResponse.json({ success: true })
}
