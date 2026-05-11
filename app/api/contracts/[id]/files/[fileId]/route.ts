import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deleteContractFile, getContractFiles } from '@/lib/db'
import { deleteFileFromDrive } from '@/lib/drive'
import { readFile, unlink } from 'fs/promises'
import path from 'path'

function buildFilePath(grNumber: string, storedName: string) {
  return path.join(process.cwd(), 'data', 'uploads', grNumber, storedName)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id, fileId } = await params
  const grNumber = id.toUpperCase()
  const fileIdNum = parseInt(fileId)
  if (isNaN(fileIdNum)) return NextResponse.json({ error: '無效 ID' }, { status: 400 })

  const files = getContractFiles(grNumber)
  const record = files.find(f => f.id === fileIdNum)
  if (!record) return NextResponse.json({ error: '找不到檔案' }, { status: 404 })

  const fp = buildFilePath(grNumber, record.storedName)
  try {
    const buffer = await readFile(fp)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': record.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch {
    return NextResponse.json({ error: '檔案不存在' }, { status: 404 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id, fileId } = await params
  const fileIdNum = parseInt(fileId)
  if (isNaN(fileIdNum)) return NextResponse.json({ error: '無效 ID' }, { status: 400 })

  const record = deleteContractFile(fileIdNum)
  if (!record) return NextResponse.json({ error: '找不到檔案' }, { status: 404 })

  const fp = buildFilePath(id.toUpperCase(), record.storedName)
  try { await unlink(fp) } catch { /* file may already be gone */ }

  if (record.driveFileId) {
    deleteFileFromDrive(session.accessToken, record.driveFileId).catch(err =>
      console.error('[Drive] 刪除失敗:', err)
    )
  }

  return NextResponse.json({ success: true })
}
