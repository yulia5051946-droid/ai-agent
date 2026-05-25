import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getContractFiles, addContractFile, getAllContractCache, getActivityLogs, addActivityLog } from '@/lib/db'
import { uploadContractFileToDrive } from '@/lib/drive'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

function extractYear(cooperationPeriod: string | null | undefined): string | null {
  if (!cooperationPeriod) return null
  const match = cooperationPeriod.match(/\d{4}/)
  return match ? match[0] : null
}

function cleanFilePart(value: string | null | undefined, fallback: string): string {
  const cleaned = (value || fallback)
    .replace(/[\\/:*?"<>|#%{}~&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

function buildArchiveName(date: Date, game: string, grNumber: string, partner: string | null | undefined, originalName: string): string {
  const ext = path.extname(originalName)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find(p => p.type === 'year')?.value ?? String(date.getUTCFullYear())
  const month = parts.find(p => p.type === 'month')?.value ?? String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = parts.find(p => p.type === 'day')?.value ?? String(date.getUTCDate()).padStart(2, '0')
  const datePart = `${year}${month}${day}`
  return `${datePart}_${cleanFilePart(game, 'unknown')}_${cleanFilePart(grNumber, 'GR')}_${cleanFilePart(partner, '合作廠商')}${ext}`
}

function uploadDir(grNumber: string) {
  return path.join(process.cwd(), 'data', 'uploads', grNumber)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const files = getContractFiles(id.toUpperCase())
  const activities = getActivityLogs(id.toUpperCase(), 30)
  return NextResponse.json({ files, activities })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = await params
  const grNumber = id.toUpperCase()

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: '未收到檔案' }, { status: 400 })

  const maxSize = 50 * 1024 * 1024
  if (file.size > maxSize) return NextResponse.json({ error: '檔案超過 50 MB 限制' }, { status: 400 })

  // 從快取取遊戲與合作時間，組成歸檔路徑與檔名
  const cache = getAllContractCache()
  const contract = cache.find(c => c.grNumber === grNumber)
  const game = contract?.game || 'unknown'
  const year = extractYear(contract?.cooperationPeriod) ?? new Date().getFullYear().toString()
  const uploadedAt = new Date()
  const archiveName = buildArchiveName(uploadedAt, game, grNumber, contract?.partner, file.name)
  const storedName = `${Date.now()}_${archiveName}`
  const dir = uploadDir(grNumber)

  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(dir, storedName), buffer)

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
    originalName: archiveName,
    storedName,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedBy: author,
    uploadedAt: uploadedAt.toISOString(),
    driveFileId,
    driveUrl,
  })
  const activity = addActivityLog({
    grNumber,
    action: 'upload_file',
    targetType: 'file',
    targetName: archiveName,
    author,
    details: file.name === archiveName ? '上傳用印文件' : `上傳用印文件；原始檔名：${file.name}`,
  })

  return NextResponse.json({ file: record, activity })
}
