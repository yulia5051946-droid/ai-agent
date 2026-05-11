'use client'

import { useState } from 'react'
import Link from 'next/link'
import { StatusBadge } from '@/components/StatusBadge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import type { ContractStatus, EmailTimelineItem } from '@/types'

interface QueryResult {
  grNumber: string
  subject: string
  messageCount: number
  lastEmailAt: string | null
  status: ContractStatus
  responsibleLegal: string | null
  hasAuthorizationLetter: boolean
  contractVersion: string | null
  financeConfirmed: boolean
  nextAction: string
  summary: string
  timeline: EmailTimelineItem[]
}

const ROLE_COLORS: Record<string, string> = {
  BD: 'bg-orange-100 text-orange-700',
  法務: 'bg-blue-100 text-blue-700',
  財務: 'bg-purple-100 text-purple-700',
  系統: 'bg-gray-100 text-gray-500',
  其他: 'bg-gray-100 text-gray-600',
}

export default function QueryPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault()
    const grNumber = input.trim().toUpperCase()
    if (!grNumber.match(/^GR\d{6}$/)) {
      setError('請輸入正確格式的合約編號，例如：GR001216')
      return
    }

    setLoading(true)
    setResult(null)
    setError('')

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grNumber }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '查詢失敗')
        return
      }
      setResult(data as QueryResult)
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">郵件查詢</h1>
        <p className="text-sm text-gray-500 mt-0.5">輸入合約編號，即時分析 Gmail 郵件串</p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleQuery} className="card p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">合約編號</label>
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="例如：GR001216"
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-300 uppercase"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input} className="btn-primary whitespace-nowrap">
            {loading ? '分析中...' : '查詢'}
          </button>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </form>

      {loading && <LoadingSpinner text="正在分析郵件串，請稍候..." />}

      {result && (
        <div className="space-y-4">
          {/* Result Header */}
          <div className="card p-6">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="font-mono font-bold text-lg">{result.grNumber}</span>
              <StatusBadge status={result.status} />
            </div>
            <p className="text-sm text-gray-500 mb-4 truncate">{result.subject}</p>

            {/* Key fields */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <KeyField label="負責法務" value={result.responsibleLegal} />
              <KeyField label="合約版本" value={result.contractVersion} />
              <KeyField label="財務確認" value={result.financeConfirmed ? '✓ 已確認' : '未確認'} />
              <KeyField label="授權信" value={result.hasAuthorizationLetter ? '✓ 已提供' : '尚未提供'} />
              <KeyField label="郵件數量" value={`${result.messageCount} 封`} />
              <KeyField
                label="最後更新"
                value={result.lastEmailAt ? new Date(result.lastEmailAt).toLocaleDateString('zh-TW') : null}
              />
            </div>

            {/* Next action */}
            <div className="mt-4 bg-orange-50 rounded-lg px-4 py-3 text-sm">
              <span className="text-orange-600 font-medium">→ 最需要做的事：</span>
              <span className="text-gray-800 ml-1">{result.nextAction}</span>
            </div>
          </div>

          {/* Summary */}
          <div className="card p-6">
            <h2 className="font-semibold text-gray-900 mb-3">AI 分析摘要</h2>
            <p className="text-sm text-gray-700 leading-relaxed">{result.summary}</p>
          </div>

          {/* Timeline */}
          {result.timeline.length > 0 && (
            <div className="card p-6">
              <h2 className="font-semibold text-gray-900 mb-4">郵件時間軸（{result.timeline.length} 封）</h2>
              <div className="space-y-3">
                {result.timeline.map((item, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <div className="shrink-0 w-20 text-xs text-gray-400 pt-0.5">
                      {new Date(item.date).toLocaleDateString('zh-TW')}
                    </div>
                    <span className={`badge shrink-0 self-start ${ROLE_COLORS[item.role] || ROLE_COLORS['其他']}`}>
                      {item.role}
                    </span>
                    <div>
                      <div className="text-xs text-gray-400 mb-0.5">{item.from}</div>
                      <div className="text-gray-700">{item.summary}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Link to detail */}
          <div className="text-center">
            <Link
              href={`/dashboard/contract/${result.grNumber}`}
              className="text-orange-600 hover:underline text-sm"
            >
              查看完整合約詳情 →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function KeyField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-gray-400 text-xs mb-0.5">{label}</dt>
      <dd className="text-gray-800 font-medium">{value || '-'}</dd>
    </div>
  )
}
