'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { StatusBadge, GameBadge, StaleBadge } from '@/components/StatusBadge'
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

            {contract.sheetData && (
              <>
                <hr className="my-4 border-gray-100" />
                <h3 className="text-sm font-medium text-gray-700 mb-3">試算表資料（即時）</h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <InfoItem label="內容簡述" value={contract.sheetData.description} />
                  <InfoItem label="合作類型" value={contract.sheetData.type} />
                  <InfoItem label="我方提供" value={contract.sheetData.ourProvisions} />
                  <InfoItem label="對方提供" value={contract.sheetData.theirProvisions} />
                  {contract.sheetData.sponsorAmountNTD && <InfoItem label="贊助金額 NTD" value={contract.sheetData.sponsorAmountNTD} />}
                  {contract.sheetData.sponsorAmountUSD && <InfoItem label="贊助金額 USD" value={contract.sheetData.sponsorAmountUSD} />}
                  <InfoItem label="負責人" value={contract.sheetData.responsiblePerson} />
                </dl>
              </>
            )}
          </div>

          {/* Timeline */}
          {contract.timeline && contract.timeline.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-semibold text-gray-900">郵件時間軸</h2>
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
  const [files, setFiles] = useState<{ id: number; originalName: string; storedName: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string; driveFileId?: string; driveUrl?: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [driveStatus, setDriveStatus] = useState<Record<number, 'uploading' | 'done' | 'error'>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/contracts/${grNumber}/files`)
      .then(r => r.json())
      .then(d => { if (d.files) setFiles(d.files) })
  }, [grNumber])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/contracts/${grNumber}/files`, { method: 'POST', body: form })
      const data = await res.json() as { file?: { id: number; originalName: string; storedName: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string; driveFileId?: string; driveUrl?: string }; error?: string }
      if (data.file) {
        setFiles(prev => [data.file!, ...prev])
        if (data.file.driveUrl) {
          setDriveStatus(s => ({ ...s, [data.file!.id]: 'done' }))
        } else {
          setDriveStatus(s => ({ ...s, [data.file!.id]: 'error' }))
        }
      }
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDelete = async (fileId: number) => {
    await fetch(`/api/contracts/${grNumber}/files/${fileId}`, { method: 'DELETE' })
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900 mb-1">用印版本</h2>
      <p className="text-xs text-gray-400 mb-4">上傳雙方已簽署用印的合約文件</p>

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
                  onClick={() => handleDelete(f.id)}
                  className="text-gray-300 hover:text-red-400 text-xs transition-colors shrink-0"
                  title="刪除"
                >✕</button>
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
    </div>
  )
}

function TimelineItem({ item }: { item: { date: string; from: string; role: string; summary: string; attachments?: { filename: string; mimeType: string; size: number; attachmentId: string; messageId: string }[] } }) {
  const [expanded, setExpanded] = useState(false)
  const MAX = 300
  const text = item.summary || ''
  const needsToggle = text.length > MAX
  const borderColor = ROLE_BORDER[item.role] || ROLE_BORDER['其他']
  const badgeColor = ROLE_COLORS[item.role] || ROLE_COLORS['其他']

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

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
              <span className="text-gray-400 shrink-0">({formatSize(a.size)})</span>
            </a>
          ))}
        </div>
      )}
    </div>
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
