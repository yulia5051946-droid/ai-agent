'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { StatusBadge, GameBadge, StaleBadge, FinanceBadge } from '@/components/StatusBadge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import type { ContractDetail, ContractStatus } from '@/types'

interface LegalNote {
  id: number
  grNumber: string
  content: string
  author: string
  createdAt: string
}

const STATUS_OPTIONS: ContractStatus[] = [
  '法務尚未回覆', '確定法務負責人', '待財務確認',
  '已提供最終清稿待用印', '合約完成', '合約取消',
]

const ROLE_COLORS: Record<string, string> = {
  BD: 'bg-orange-100 text-orange-700 border-orange-200',
  法務: 'bg-blue-100 text-blue-700 border-blue-200',
  財務: 'bg-purple-100 text-purple-700 border-purple-200',
  系統: 'bg-gray-100 text-gray-500 border-gray-200',
  其他: 'bg-gray-100 text-gray-600 border-gray-200',
}

const ROLE_BORDER: Record<string, string> = {
  BD: 'border-l-orange-400',
  法務: 'border-l-blue-400',
  財務: 'border-l-purple-400',
  系統: 'border-l-gray-300',
  其他: 'border-l-gray-300',
}

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lockStatus, setLockStatus] = useState<ContractStatus | ''>('')
  const [lockLoading, setLockLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/contracts/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setContract(data as ContractDetail)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleLock = async () => {
    if (!lockStatus) return
    setLockLoading(true)
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lock', status: lockStatus }),
      })
      const data = await res.json()
      if (data.success && contract) {
        setContract({ ...contract, status: data.status, isManuallyLocked: true })
      }
    } finally {
      setLockLoading(false)
    }
  }

  const handleUnlock = async () => {
    setLockLoading(true)
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock' }),
      })
      const data = await res.json()
      if (data.success && contract) {
        setContract({ ...contract, isManuallyLocked: false, manualStatus: undefined })
      }
    } finally {
      setLockLoading(false)
    }
  }

  if (loading) return <LoadingSpinner text={`正在分析 ${id} 的郵件...`} />
  if (error) return (
    <div className="space-y-4">
      <Link href="/dashboard" className="text-sm text-orange-600 hover:underline">← 返回總覽</Link>
      <div className="card p-8 text-center text-red-600">{error}</div>
    </div>
  )
  if (!contract) return null
  const mailAttachments = (contract.timeline || []).flatMap((item, messageIndex) =>
    (item.attachments || []).map(attachment => ({
      ...attachment,
      role: item.role,
      from: item.from,
      date: item.date,
      messageIndex,
      stage: classifyAttachmentStage(item.role, attachment.filename, item.summary),
    }))
  )

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/dashboard" className="hover:text-orange-600">合約總覽</Link>
        <span>/</span>
        <span className="font-mono text-gray-900">{id}</span>
      </div>

      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-mono font-bold text-xl text-gray-900">{contract.grNumber}</span>
              <GameBadge game={contract.game} />
              <StatusBadge status={contract.status} locked={contract.isManuallyLocked} />
              <StaleBadge days={contract.daysStale || 0} />
              {(contract.status === '已提供最終清稿待用印' ||
                contract.status === '待財務確認' ||
                (typeof contract.status === 'string' && contract.status.startsWith('法務已提供'))) &&
                <FinanceBadge confirmed={contract.financeConfirmed} />
              }
            </div>
            <p className="text-gray-600 text-sm truncate">{contract.subject}</p>
          </div>
        </div>

        {/* Summary */}
        {contract.summary && (
          <div className="mt-4 bg-orange-50 rounded-lg p-4 text-sm text-gray-700">
            {contract.summary}
          </div>
        )}

        {/* Next action */}
        {contract.nextAction && (
          <div className="mt-3 flex items-start gap-2 text-sm">
            <span className="text-orange-500 font-medium shrink-0">→ 下一步：</span>
            <span className="text-gray-700">{contract.nextAction}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left (1/3): 法務行動區 */}
        <div className="space-y-6">

          {/* 合約狀態控制 */}
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 mb-1">合約狀態</h2>
            <p className="text-xs text-gray-400 mb-3">鎖定後 AI 不會自動覆蓋</p>
            {contract.isManuallyLocked ? (
              <div className="space-y-3">
                <div className="bg-orange-50 rounded-lg p-3 text-sm">
                  <span className="text-orange-700">🔒 目前已鎖定：</span>
                  <span className="font-medium text-orange-800 ml-1">{contract.status}</span>
                </div>
                <button onClick={handleUnlock} disabled={lockLoading} className="btn-secondary w-full text-sm">
                  {lockLoading ? '處理中...' : '解除鎖定'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <select
                  value={lockStatus}
                  onChange={e => setLockStatus(e.target.value as ContractStatus)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                >
                  <option value="">選擇要鎖定的狀態...</option>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={handleLock} disabled={!lockStatus || lockLoading} className="btn-primary w-full text-sm disabled:opacity-50">
                  {lockLoading ? '處理中...' : '鎖定狀態'}
                </button>
              </div>
            )}
          </div>

          {/* 法務備註 */}
          <NotesPanel grNumber={id} />

          {/* 用印版本 */}
          <FilesPanel grNumber={id} />

          {/* 財務資訊 */}
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 mb-4">財務資訊</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500 text-xs mb-0.5">付款條件確認</dt>
                <dd className={`font-medium ${contract.financeConfirmed ? 'text-green-600' : 'text-gray-500'}`}>
                  {contract.financeConfirmed ? '✓ 已確認' : '尚未確認'}
                </dd>
              </div>
              {contract.financeInfo && (
                <>
                  {contract.financeInfo.invoiceAppliedAt && (
                    <div>
                      <dt className="text-gray-500 text-xs mb-0.5">發票申請時間</dt>
                      <dd>{new Date(contract.financeInfo.invoiceAppliedAt).toLocaleDateString('zh-TW')}</dd>
                    </div>
                  )}
                  {contract.financeInfo.invoiceIssuedAt && (
                    <div>
                      <dt className="text-gray-500 text-xs mb-0.5">發票開立時間</dt>
                      <dd>{new Date(contract.financeInfo.invoiceIssuedAt).toLocaleDateString('zh-TW')}</dd>
                    </div>
                  )}
                  {contract.financeInfo.amount && (
                    <div>
                      <dt className="text-gray-500 text-xs mb-0.5">金額</dt>
                      <dd className="font-medium">{contract.financeInfo.amount}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>
          </div>
        </div>

        {/* Right (2/3): 合約詳情 + 時間軸 */}
        <div className="lg:col-span-2 space-y-6">

          {/* Key Info */}
          <div className="card p-6">
            <h2 className="font-semibold text-gray-900 mb-4">合約基本資訊</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <InfoItem label="合作對象" value={contract.partner} />
              <InfoItem label="負責法務" value={contract.responsibleLegal} />
              <InfoItem label="負責人（行銷/商務）" value={contract.responsiblePerson} />
              <InfoItem label="類型" value={contract.contractType} />
              <InfoItem label="內容簡述" value={contract.description} />
              <InfoItem label="合約版本" value={contract.contractVersion} />
              <InfoItem label="授權信" value={contract.hasAuthorizationLetter === undefined ? null : contract.hasAuthorizationLetter ? '已提供' : '尚未提供'} />
              <InfoItem label="合作時間" value={contract.cooperationPeriod} />
              <InfoItem label="露出賽季" value={contract.exposureSeason} />
              <InfoItem label="贊助金額（NTD）" value={contract.sponsorAmountNTD} />
              <InfoItem label="申請日期" value={contract.appliedAt ? new Date(contract.appliedAt).toLocaleDateString('zh-TW') : null} />
              <InfoItem label="最新郵件日期" value={contract.lastEmailAt ? new Date(contract.lastEmailAt).toLocaleDateString('zh-TW') : null} />
            </dl>

            {(contract.ourProvisions || contract.theirProvisions) && (
              <>
                <hr className="my-4 border-gray-100" />
                <dl className="grid grid-cols-1 gap-y-3 text-sm">
                  <InfoItem label="我方提供" value={contract.ourProvisions} />
                  <InfoItem label="對方提供（含各條價值）" value={contract.theirProvisions} />
                </dl>
              </>
            )}

            {contract.legalProgressNote && (
              <>
                <hr className="my-4 border-gray-100" />
                <div className="text-sm">
                  <dt className="text-gray-500 text-xs mb-1">法務進度備註（AI 摘錄）</dt>
                  <dd className="text-gray-800 bg-blue-50 rounded p-3 text-xs leading-relaxed whitespace-pre-wrap">{contract.legalProgressNote}</dd>
                </div>
              </>
            )}

            <hr className="my-4 border-gray-100" />
            <SheetLinkPanel
              grNumber={id}
              sheetData={contract.sheetData}
              sheetLinkMode={contract.sheetLinkMode}
              initialManualData={{
                description: contract.description,
                contractType: contract.contractType,
                exposureSeason: contract.exposureSeason,
                ourProvisions: contract.ourProvisions,
                theirProvisions: contract.theirProvisions,
                sponsorAmountNTD: contract.sponsorAmountNTD,
                sponsorAmountUSD: contract.sponsorAmountUSD,
                cooperationPeriod: contract.cooperationPeriod,
                responsiblePerson: contract.responsiblePerson,
              }}
            />
          </div>

          {/* Mail attachments */}
          {mailAttachments.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-gray-900">郵件附件總覽</h2>
                  <p className="text-xs text-gray-500 mt-0.5">包含各階段往來信件中的合約版本與法務/財務附件</p>
                </div>
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-1">{mailAttachments.length} 個檔案</span>
              </div>
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                {mailAttachments.map((a, i) => (
                  <a
                    key={`${a.messageId}-${a.attachmentId}-${i}`}
                    href={`/api/attachments/${a.messageId}/${a.attachmentId}?filename=${encodeURIComponent(a.filename)}&mime=${encodeURIComponent(a.mimeType)}`}
                    download={a.filename}
                    className="flex items-center justify-between gap-3 px-4 py-3 bg-white hover:bg-orange-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${ROLE_COLORS[a.role] || ROLE_COLORS['其他']}`}>
                          {a.role}
                        </span>
                        <span className="text-xs text-orange-600 bg-orange-50 rounded px-2 py-0.5">{a.stage}</span>
                        <span className="text-sm font-medium text-gray-900 truncate">{a.filename}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400 truncate">
                        {new Date(a.date).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} · {a.from}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">{formatFileSize(a.size)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          {contract.timeline && contract.timeline.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-semibold text-gray-900">郵件時間軸</h2>
                  <p className="text-xs text-gray-500 mt-0.5">依 Gmail 郵件串同步，保留每封信內容與附件下載</p>
                </div>
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-1">{contract.timeline.length} 封</span>
              </div>
              <div className="space-y-3">
                {contract.timeline.map((item, i) => (
                  <TimelineItem key={i} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function classifyAttachmentStage(role: string, filename: string, summary: string) {
  const text = `${filename} ${summary}`.toLowerCase()
  if (/clean|清稿|final|最終/.test(text)) return '最終清稿'
  if (/v\d+|version|版本|draft|草稿/.test(text)) return '合約版本'
  if (/授權/.test(text)) return '授權信'
  if (/invoice|發票|請款/.test(text)) return '財務文件'
  if (role === '法務') return '法務附件'
  if (role === '財務') return '財務附件'
  if (role === 'BD') return 'BD 附件'
  return '郵件附件'
}

function NotesPanel({ grNumber }: { grNumber: string }) {
  const [notes, setNotes] = useState<LegalNote[]>([])
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/api/contracts/${grNumber}/notes`)
      .then(r => r.json())
      .then(d => { if (d.notes) setNotes(d.notes) })
  }, [grNumber])

  const handleSubmit = async () => {
    if (!input.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/contracts/${grNumber}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input.trim() }),
      })
      const data = await res.json()
      if (data.note) {
        setNotes(prev => [...prev, data.note])
        setInput('')
        textareaRef.current?.focus()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (noteId: number) => {
    await fetch(`/api/contracts/${grNumber}/notes`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId }),
    })
    setNotes(prev => prev.filter(n => n.id !== noteId))
  }

  const formatAuthor = (email: string) => email.split('@')[0]

  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900 mb-4">法務備註</h2>

      {/* Existing notes */}
      {notes.length > 0 && (
        <div className="space-y-3 mb-4">
          {notes.map(note => (
            <div key={note.id} className="bg-yellow-50 border border-yellow-100 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded">
                    {formatAuthor(note.author)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(note.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="text-gray-300 hover:text-red-400 text-xs transition-colors"
                  title="刪除此備註"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{note.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="space-y-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit() }}
          placeholder="輸入備註內容... (Ctrl+Enter 送出)"
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || submitting}
          className="btn-primary w-full text-sm disabled:opacity-50"
        >
          {submitting ? '送出中...' : '新增備註'}
        </button>
      </div>
    </div>
  )
}

function FilesPanel({ grNumber }: { grNumber: string }) {
  type ContractFileItem = { id: number; originalName: string; storedName: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string; driveFileId?: string; driveUrl?: string }
  type ActivityItem = { id: number; action: string; targetName: string | null; author: string; createdAt: string; details: string | null }
  const [files, setFiles] = useState<ContractFileItem[]>([])
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ContractFileItem | null>(null)
  const [fileError, setFileError] = useState('')
  const [driveStatus, setDriveStatus] = useState<Record<number, 'uploading' | 'done' | 'error'>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/contracts/${grNumber}/files`)
      .then(r => r.json())
      .then(d => {
        if (d.files) setFiles(d.files)
        if (d.activities) setActivities(d.activities)
      })
  }, [grNumber])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setFileError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/contracts/${grNumber}/files`, { method: 'POST', body: form })
      const data = await res.json() as { file?: ContractFileItem; activity?: ActivityItem; error?: string }
      if (!res.ok) throw new Error(data.error || '上傳失敗')
      if (data.file) {
        setFiles(prev => [data.file!, ...prev])
        if (data.activity) setActivities(prev => [data.activity!, ...prev].slice(0, 30))
        if (data.file.driveUrl) {
          setDriveStatus(s => ({ ...s, [data.file!.id]: 'done' }))
        } else {
          setDriveStatus(s => ({ ...s, [data.file!.id]: 'error' }))
        }
      }
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '上傳失敗')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeletingId(deleteTarget.id)
    setFileError('')
    try {
      const res = await fetch(`/api/contracts/${grNumber}/files/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json() as { success?: boolean; activities?: ActivityItem[]; error?: string }
      if (!res.ok) throw new Error(data.error || '刪除失敗')
      setFiles(prev => prev.filter(f => f.id !== deleteTarget.id))
      if (data.activities) setActivities(data.activities)
      setDeleteTarget(null)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setDeletingId(null)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const activityLabel = (item: ActivityItem) => {
    const map: Record<string, string> = {
      upload_file: '上傳用印文件',
      delete_file: '刪除用印文件',
      lock_status: '更新合約狀態',
      unlock_status: '取消狀態鎖定',
      set_game: '更新遊戲項目',
      manual_resource: '更新手動資源內容',
      link_sheet: '更新 Sheet 對應列',
      add_note: '新增備註',
      delete_note: '刪除備註',
    }
    return map[item.action] || item.action
  }

  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900 mb-1">用印版本</h2>
      <p className="text-xs text-gray-400 mb-4">上傳雙方已簽署用印的合約文件</p>

      {fileError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {fileError}
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2 mb-4">
          {files.map(f => (
            <div key={f.id} className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-blue-500 shrink-0">📄</span>
                <div className="flex-1 min-w-0">
                  <a
                    href={`/api/contracts/${grNumber}/files/${f.id}?name=${encodeURIComponent(f.originalName)}`}
                    download={f.originalName}
                    className="text-sm font-medium text-blue-700 hover:underline truncate block"
                  >
                    {f.originalName}
                  </a>
                  <p className="text-xs text-gray-400">
                    {f.uploadedBy.split('@')[0]} · {new Date(f.uploadedAt).toLocaleDateString('zh-TW')} · {formatSize(f.size)}
                  </p>
                </div>
                <button
                  onClick={() => setDeleteTarget(f)}
                  disabled={deletingId === f.id}
                  className="text-gray-300 hover:text-red-400 text-xs transition-colors shrink-0 disabled:opacity-40"
                  title="刪除"
                >{deletingId === f.id ? '刪除中' : '✕'}</button>
              </div>
              {f.driveUrl && !f.driveUrl.startsWith('error:') ? (
                <a
                  href={f.driveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
                >
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 0L0 11.4l3.3 5.7h13.2l3.3-5.7zm10.8 0h-4.2L24 15.6l-3.3 5.7 4.2-7.2zm-4.2 15.6H4.8L1.5 21.3h20.4z"/></svg>
                  已歸檔到 Google Drive
                </a>
              ) : f.driveUrl?.startsWith('error:') ? (
                <p className="mt-1 text-xs text-red-400" title={f.driveUrl.slice(6)}>
                  Drive 歸檔失敗：{f.driveUrl.slice(6).slice(0, 80)}
                </p>
              ) : driveStatus[f.id] === 'error' ? (
                <p className="mt-1 text-xs text-red-400">Drive 歸檔失敗（本地已存）</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <input ref={inputRef} type="file" onChange={handleUpload} className="hidden" accept=".pdf,.doc,.docx,.xlsx,.zip,.png,.jpg" />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="btn-primary w-full text-sm disabled:opacity-50"
      >
        {uploading ? '上傳中...' : '+ 上傳用印文件'}
      </button>
      <p className="text-xs text-gray-400 mt-1.5 text-center">支援 PDF、Word、Excel、ZIP、圖片，限 50 MB</p>

      {activities.length > 0 && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">最近編輯紀錄</h3>
          <div className="space-y-2">
            {activities.slice(0, 6).map(item => (
              <div key={item.id} className="text-xs text-gray-500 leading-relaxed">
                <span className="font-medium text-gray-700">{item.author.split('@')[0]}</span>
                <span> {activityLabel(item)}</span>
                {item.targetName && <span className="text-gray-700">：{item.targetName}</span>}
                <span className="ml-1 text-gray-400">
                  {new Date(item.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">確認刪除用印文件？</h3>
            <p className="mt-2 text-sm text-gray-600 break-words">
              刪除後會同步移除 Google Drive 上的歸檔檔案，這個動作會留下編輯紀錄。
            </p>
            <p className="mt-3 rounded bg-gray-50 px-3 py-2 text-xs text-gray-700 break-words">
              {deleteTarget.originalName}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deletingId !== null}
                className="btn-secondary text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={deletingId !== null}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deletingId !== null ? '刪除中...' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineItem({ item }: { item: { date: string; from: string; role: string; summary: string; attachments?: { filename: string; mimeType: string; size: number; attachmentId: string; messageId: string }[] } }) {
  const [expanded, setExpanded] = useState(false)
  const MAX = 900
  const text = item.summary || ''
  const needsToggle = text.length > MAX
  const borderColor = ROLE_BORDER[item.role] || ROLE_BORDER['其他']
  const badgeColor = ROLE_COLORS[item.role] || ROLE_COLORS['其他']

  return (
    <div className={`border-l-4 ${borderColor} bg-gray-50 rounded-r-lg p-4 border border-gray-100`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${badgeColor}`}>
          {item.role}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(item.date).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
        </span>
        <span className="text-xs text-gray-500 truncate max-w-xs">{item.from}</span>
      </div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">郵件內容</div>
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
        {needsToggle && !expanded ? text.slice(0, MAX) + '…' : text}
      </p>
      {needsToggle && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-1.5 text-xs text-orange-500 hover:text-orange-700"
        >
          {expanded ? '▲ 收起' : '▼ 展開全文'}
        </button>
      )}
      {item.attachments && item.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.attachments.map((a, i) => (
            <a
              key={i}
              href={`/api/attachments/${a.messageId}/${a.attachmentId}?filename=${encodeURIComponent(a.filename)}&mime=${encodeURIComponent(a.mimeType)}`}
              download={a.filename}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 hover:border-orange-300 hover:text-orange-600 transition-colors"
            >
              <span>📎</span>
              <span className="truncate max-w-[160px]">{a.filename}</span>
              <span className="text-gray-400 shrink-0">({formatFileSize(a.size)})</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SheetLinkPanel ────────────────────────────────────────────────────────────
interface SheetCandidate {
  rowKey: string
  partner: string
  description: string
  type: string
  game: string
  exposureSeason: string
  cooperationPeriod: string
  responsiblePerson: string
  currentGr: string | null
  isLinkedToThis: boolean
}

interface ManualResourceData {
  description?: string | null
  contractType?: string | null
  exposureSeason?: string | null
  ourProvisions?: string | null
  theirProvisions?: string | null
  sponsorAmountNTD?: string | null
  sponsorAmountUSD?: string | null
  cooperationPeriod?: string | null
  responsiblePerson?: string | null
}

function SheetLinkPanel({
  grNumber,
  sheetData,
  sheetLinkMode,
  initialManualData,
}: {
  grNumber: string
  sheetData?: { description?: string; type?: string; responsiblePerson?: string; exposureSeason?: string; sponsorAmountNTD?: string; sponsorAmountUSD?: string; ourProvisions?: string; theirProvisions?: string; } | null
  sheetLinkMode?: 'auto' | 'manual'
  initialManualData: ManualResourceData
}) {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<SheetCandidate[]>([])
  const [contractGame, setContractGame] = useState('')
  const [mode, setMode] = useState<'auto' | 'manual'>(sheetLinkMode || 'auto')
  const [manualForm, setManualForm] = useState<ManualResourceData>(initialManualData)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const fetchCandidates = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/contracts/${grNumber}/sheet-link`)
      const data = await res.json() as { candidates?: SheetCandidate[]; contractGame?: string; sheetLinkMode?: 'auto' | 'manual'; manualData?: ManualResourceData | null; error?: string }
      if (data.error) throw new Error(data.error)
      setCandidates(data.candidates || [])
      setContractGame(data.contractGame || '')
      if (data.sheetLinkMode) setMode(data.sheetLinkMode)
      if (data.manualData) setManualForm(data.manualData)
    } catch (e) {
      setError(e instanceof Error ? e.message : '讀取失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = () => {
    setOpen(true)
    if (candidates.length === 0) fetchCandidates()
  }

  const handleLink = async (rowKey: string) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/contracts/${grNumber}/sheet-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowKey }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (data.error) throw new Error(data.error)
      setSavedKey(rowKey)
      setMode('auto')
      setOpen(false)
      // Update local candidates to reflect new link
      setCandidates(prev => prev.map(c => ({
        ...c,
        isLinkedToThis: c.rowKey === rowKey,
        currentGr: c.rowKey === rowKey ? grNumber : (c.isLinkedToThis ? null : c.currentGr),
      })))
    } catch (e) {
      setError(e instanceof Error ? e.message : '連結失敗')
    } finally {
      setSaving(false)
    }
  }

  const handleManualSave = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/contracts/${grNumber}/sheet-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'manual', data: manualForm }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (data.error) throw new Error(data.error)
      setMode('manual')
      setSavedKey(null)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const filtered = search.trim()
    ? candidates.filter(c =>
        [c.partner, c.description, c.type, c.exposureSeason, c.responsiblePerson]
          .join(' ').toLowerCase().includes(search.trim().toLowerCase())
      )
    : candidates

  const linkedCandidate = candidates.find(c => c.isLinkedToThis)
  const hasManualContent = Object.values(manualForm).some(v => typeof v === 'string' && v.trim())

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">
          試算表資料
          {mode === 'manual' && (
            <span className="ml-2 text-xs text-amber-600 font-normal">不連結表格</span>
          )}
          {(linkedCandidate || savedKey) && (
            <span className="ml-2 text-xs text-emerald-600 font-normal">✓ 已連結</span>
          )}
        </h3>
        <button
          onClick={handleOpen}
          className="text-xs text-orange-500 hover:text-orange-700 border border-orange-200 rounded px-2 py-0.5 hover:bg-orange-50 transition-colors"
        >
          {sheetData ? '重新對應 Sheet 列' : '手動連結 Sheet 列'}
        </button>
      </div>

      {/* Current match preview */}
      {mode === 'manual' ? (
        hasManualContent ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <InfoItem label="內容簡述" value={manualForm.description} />
            <InfoItem label="合作類型" value={manualForm.contractType} />
            <InfoItem label="我方提供" value={manualForm.ourProvisions} />
            <InfoItem label="對方提供" value={manualForm.theirProvisions} />
            {manualForm.sponsorAmountNTD && <InfoItem label="贊助金額 NTD" value={manualForm.sponsorAmountNTD} />}
            {manualForm.sponsorAmountUSD && <InfoItem label="贊助金額 USD" value={manualForm.sponsorAmountUSD} />}
            <InfoItem label="合作時間" value={manualForm.cooperationPeriod} />
            <InfoItem label="露出賽季" value={manualForm.exposureSeason} />
            <InfoItem label="負責人" value={manualForm.responsiblePerson} />
          </dl>
        ) : (
          <p className="text-sm text-amber-600">此合約設定為不連結表格，尚未填寫資源內容</p>
        )
      ) : sheetData ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <InfoItem label="內容簡述" value={sheetData.description} />
          <InfoItem label="合作類型" value={sheetData.type} />
          <InfoItem label="我方提供" value={sheetData.ourProvisions} />
          <InfoItem label="對方提供" value={sheetData.theirProvisions} />
          {sheetData.sponsorAmountNTD && <InfoItem label="贊助金額 NTD" value={sheetData.sponsorAmountNTD} />}
          {sheetData.sponsorAmountUSD && <InfoItem label="贊助金額 USD" value={sheetData.sponsorAmountUSD} />}
          <InfoItem label="負責人" value={sheetData.responsiblePerson} />
        </dl>
      ) : (
        <p className="text-sm text-gray-400 italic">尚未比對到試算表列，請手動連結</p>
      )}

      {/* Picker modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">選擇 Sheet 列</h2>
                <p className="text-xs text-gray-500 mt-0.5">選擇後系統會自動在試算表寫入 GR 編號，下次同步即可精準比對</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100">
              <input
                type="text"
                placeholder="搜尋廠商名稱、內容簡述、負責人..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                autoFocus
              />
            </div>

            <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-amber-800">不連結表格</p>
                  <p className="text-xs text-amber-700 mt-0.5">適用沒有 Sheet 列的合約，資源內容改由下方手動維護，後續同步不會覆蓋。</p>
                </div>
                <button
                  onClick={() => setMode('manual')}
                  className={`text-xs rounded px-3 py-1.5 border transition-colors ${
                    mode === 'manual'
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  使用手動內容
                </button>
              </div>
              {mode === 'manual' && (
                <ManualResourceForm
                  value={manualForm}
                  onChange={setManualForm}
                  onSave={handleManualSave}
                  saving={saving}
                />
              )}
            </div>

            <div className="overflow-y-auto flex-1 px-2 py-2">
              {loading && (
                <div className="py-12 text-center text-gray-400 text-sm">載入試算表中...</div>
              )}
              {error && (
                <div className="py-4 text-center text-red-500 text-sm">{error}</div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="py-12 text-center text-gray-400 text-sm">沒有符合的列</div>
              )}
              {!loading && filtered.map(c => {
                const isCurrentGame = c.game === contractGame
                const isLinked = c.isLinkedToThis || c.rowKey === savedKey
                const isOtherGr = c.currentGr && !c.isLinkedToThis

                return (
                  <div
                    key={c.rowKey}
                    className={`px-4 py-3 rounded-lg mb-1.5 border cursor-pointer transition-all ${
                      isLinked
                        ? 'bg-emerald-50 border-emerald-200'
                        : isOtherGr
                        ? 'bg-gray-50 border-gray-100 opacity-60'
                        : 'bg-white border-gray-100 hover:bg-orange-50 hover:border-orange-200'
                    }`}
                    onClick={() => !saving && handleLink(c.rowKey)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                          isCurrentGame ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
                        }`}>{c.game}</span>
                        <span className="font-medium text-gray-900 truncate text-sm">{c.partner}</span>
                        {c.exposureSeason && <span className="text-xs text-gray-400 shrink-0">{c.exposureSeason}</span>}
                      </div>
                      <div className="shrink-0 text-xs">
                        {isLinked && <span className="text-emerald-600 font-medium">✓ 已連結</span>}
                        {isOtherGr && <span className="text-gray-400">已連 {c.currentGr}</span>}
                        {saving && <span className="text-orange-400">寫入中...</span>}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">{c.description || '（無描述）'}</p>
                    {(c.type || c.cooperationPeriod) && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[c.type, c.cooperationPeriod].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
              共 {filtered.length} 列{search ? `（已篩選，全部 ${candidates.length} 列）` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ManualResourceForm({
  value,
  onChange,
  onSave,
  saving,
}: {
  value: ManualResourceData
  onChange: (value: ManualResourceData) => void
  onSave: () => void
  saving: boolean
}) {
  const setField = (key: keyof ManualResourceData, fieldValue: string) => {
    onChange({ ...value, [key]: fieldValue })
  }

  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <ManualInput label="內容簡述" value={value.description} onChange={v => setField('description', v)} />
      <ManualInput label="合作類型" value={value.contractType} onChange={v => setField('contractType', v)} />
      <ManualInput label="合作時間" value={value.cooperationPeriod} onChange={v => setField('cooperationPeriod', v)} />
      <ManualInput label="露出賽季" value={value.exposureSeason} onChange={v => setField('exposureSeason', v)} />
      <ManualInput label="贊助金額 NTD" value={value.sponsorAmountNTD} onChange={v => setField('sponsorAmountNTD', v)} />
      <ManualInput label="贊助金額 USD" value={value.sponsorAmountUSD} onChange={v => setField('sponsorAmountUSD', v)} />
      <ManualInput label="負責人" value={value.responsiblePerson} onChange={v => setField('responsiblePerson', v)} />
      <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ManualTextarea label="我方提供" value={value.ourProvisions} onChange={v => setField('ourProvisions', v)} />
        <ManualTextarea label="對方提供" value={value.theirProvisions} onChange={v => setField('theirProvisions', v)} />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {saving ? '儲存中...' : '儲存手動內容'}
        </button>
      </div>
    </div>
  )
}

function ManualInput({ label, value, onChange }: { label: string; value?: string | null; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
      />
    </label>
  )
}

function ManualTextarea({ label, value, onChange }: { label: string; value?: string | null; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white resize-none"
      />
    </label>
  )
}

function InfoItem({ label, value, max = 120 }: { label: string; value: string | null | undefined; max?: number }) {
  const [expanded, setExpanded] = useState(false)
  const text = value || ''
  const needsToggle = text.length > max
  return (
    <div>
      <dt className="text-gray-500 text-xs mb-0.5">{label}</dt>
      <dd className="text-gray-800 break-words">
        {!text ? (
          <span className="text-gray-400">-</span>
        ) : (
          <>
            <span className="whitespace-pre-wrap">
              {needsToggle && !expanded ? text.slice(0, max) + '…' : text}
            </span>
            {needsToggle && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="ml-1 text-orange-500 hover:text-orange-700 text-xs"
              >
                {expanded ? '收起' : '展開'}
              </button>
            )}
          </>
        )}
      </dd>
    </div>
  )
}
