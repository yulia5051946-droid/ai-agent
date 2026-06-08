import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { addActivityLog, deleteContractFile, getActivityLogs, getContractFiles } from '@/lib/db'
import { deleteFileFromDrive, downloadFileFromDrive } from '@/lib/drive'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'

function uploadRoot() {
  const dbPath = process.env.DB_PATH
  return process.env.UPLOAD_DIR || path.join(dbPath ? path.dirname(dbPath) : path.join(process.cwd(), 'data'), 'uploads')
}

function buildFilePath(grNumber: string, storedName: string) {
  return path.join(uploadRoot(), grNumber, storedName)
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null) {
    const maybeResponse = (err as { response?: { status?: number } }).response
    const maybeCode = (err as { code?: number | string }).code
    if (typeof maybeResponse?.status === 'number') return maybeResponse.status
    if (typeof maybeCode === 'number') return maybeCode
    if (typeof maybeCode === 'string') {
      const parsed = parseInt(maybeCode, 10)
      return Number.isNaN(parsed) ? undefined : parsed
    }
  }
  return undefined
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = await auth()
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
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': record.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch {
    if (!record.driveFileId) {
      return NextResponse.json({ error: '檔案不存在' }, { status: 404 })
    }

    try {
      const buffer = await downloadFileFromDrive(session.accessToken, record.driveFileId)
      await mkdir(path.dirname(fp), { recursive: true })
      await writeFile(fp, buffer)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': record.mimeType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
          'Content-Length': String(buffer.length),
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Drive] 檔案回補下載失敗:', msg)
      return NextResponse.json({ error: `本機檔案不存在，且 Google Drive 回補失敗：${msg}` }, { status: 404 })
    }
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id, fileId } = await params
  const grNumber = id.toUpperCase()
  const fileIdNum = parseInt(fileId)
  if (isNaN(fileIdNum)) return NextResponse.json({ error: '無效 ID' }, { status: 400 })

  const record = getContractFiles(grNumber).find(f => f.id === fileIdNum)
  if (!record) return NextResponse.json({ error: '找不到檔案' }, { status: 404 })

  if (record.driveFileId) {
    try {
      await deleteFileFromDrive(session.accessToken, record.driveFileId)
    } catch (err) {
      const status = getErrorStatus(err)
      if (status !== 404) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Drive] 刪除失敗:', msg)
        return NextResponse.json({ error: `Google Drive 刪除失敗：${msg}` }, { status: 502 })
      }
    }
  }

  deleteContractFile(fileIdNum)

  const fp = buildFilePath(grNumber, record.storedName)
  try { await unlink(fp) } catch { /* file may already be gone */ }

  const author = session.user?.email || session.user?.name || '未知使用者'
  const activity = addActivityLog({
    grNumber,
    action: 'delete_file',
    targetType: 'file',
    targetName: record.originalName,
    author,
    details: record.driveFileId ? '已同步刪除 Google Drive 檔案' : '刪除本機用印文件',
  })

  return NextResponse.json({ success: true, activity, activities: getActivityLogs(grNumber, 30) })
}
