import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getContractFiles, addContractFile, getAllContractCache } from '@/lib/db'
import { uploadContractFileToDrive } from '@/lib/drive'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

function extractYear(cooperationPeriod: string | null | undefined): string | null {
  if (!cooperationPeriod) return null
  const match = cooperationPeriod.match(/\d{4}/)
  return match ? match[0] : null
}

function buildArchiveName(year: string | null, originalName: string): string {
  const ext = path.extname(originalName)
  const base = path.basename(originalName, ext)
  return year ? `${year}_${base}${ext}` : originalName
}

function uploadDir(grNumber: string) {
  return path.join(process.cwd(), 'data', 'uploads', grNumber)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const files = getContractFiles(id.toUpperCase())
  return NextResponse.json({ files })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const grNumber = id.toUpperCase()

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: '未收到檔案' }, { status: 400 })

  const maxSize = 50 * 1024 * 1024
  if (file.size > maxSize) return NextResponse.json({ error: '檔案超過 50 MB 限制' }, { status: 400 })

  const timestamp = Date.now()
  const ext = path.extname(file.name)
  const storedName = `${timestamp}${ext}`
  const dir = uploadDir(grNumber)

  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(dir, storedName), buffer)

  // 從快取取遊戲與合作時間，組成歸檔路徑與檔名
  const cache = getAllContractCache()
  const contract = cache.find(c => c.grNumber === grNumber)
  const game = contract?.game || 'unknown'
  const year = extractYear(contract?.cooperationPeriod) ?? new Date().getFullYear().toString()
  const archiveName = buildArchiveName(year, file.name)

  // 同步上傳到 Google Drive
  let driveFileId: string | undefined
  let driveUrl: string | undefined
  try {
    const result = await uploadContractFileToDrive(
      session.accessToken,
      game,
      year,
      archiveName,
      file.type || 'application/octet-stream',
      buffer
    )
    driveFileId = result.fileId
    driveUrl = result.url
    console.log(`[Drive] ${grNumber} 已歸檔: ${archiveName} → ${driveUrl}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Drive] 上傳失敗 ${grNumber}/${archiveName}:`, msg)
    // Drive 失敗不影響本地上傳，錯誤訊息存入 driveUrl 供前端顯示
    driveUrl = `error:${msg}`
  }

  const author = session.user?.email || session.user?.name || '未知使用者'
  const record = addContractFile({
    grNumber,
    originalName: file.name,
    storedName,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedBy: author,
    uploadedAt: new Date().toISOString(),
    driveFileId,
    driveUrl,
  })

  return NextResponse.json({ file: record })
}
