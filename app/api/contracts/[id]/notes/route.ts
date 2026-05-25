import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { addActivityLog, getLegalNotes, addLegalNote, deleteLegalNote } from '@/lib/db'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const notes = getLegalNotes(id.toUpperCase())
  return NextResponse.json({ notes })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as { content?: string }
  if (!body.content?.trim()) return NextResponse.json({ error: '備註內容不得為空' }, { status: 400 })

  const author = session.user?.email || session.user?.name || '未知使用者'
  const grNumber = id.toUpperCase()
  const note = addLegalNote(grNumber, body.content.trim(), author)
  addActivityLog({
    grNumber,
    action: 'add_note',
    targetType: 'note',
    targetName: `#${note.id}`,
    author,
    details: '新增法務備註',
  })
  return NextResponse.json({ note })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const grNumber = id.toUpperCase()
  const body = await request.json() as { noteId?: number }
  if (!body.noteId) return NextResponse.json({ error: '缺少 noteId' }, { status: 400 })

  deleteLegalNote(body.noteId)
  addActivityLog({
    grNumber,
    action: 'delete_note',
    targetType: 'note',
    targetName: `#${body.noteId}`,
    author: session.user?.email || session.user?.name || '未知使用者',
    details: '刪除法務備註',
  })
  return NextResponse.json({ success: true })
}
