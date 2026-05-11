'use client'

import { useState, useEffect, useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import { StatusBadge, StaleBadge } from '@/components/StatusBadge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import type { Contract, ContractStatus, GameType } from '@/types'

const STATUS_OPTIONS: ContractStatus[] = [
  '法務尚未回覆', '確定法務負責人', '待財務確認',
  '已提供最終清稿待用印', '合約完成', '合約取消',
]
const GAME_OPTIONS: GameType[] = ['AOV', 'DF', 'CODM']
const GAME_SELECT_OPTIONS: GameType[] = ['AOV', 'DF', 'CODM', 'unknown']
const GAME_TABS: { key: GameType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'AOV', label: 'AOV' },
  { key: 'DF', label: 'DF' },
  { key: 'CODM', label: 'CODM' },
]

export default function DashboardPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [filterGame, setFilterGame] = useState<GameType | ''>('')
  const [filterStatus, setFilterStatus] = useState<ContractStatus | ''>('')
  const [filterLegal, setFilterLegal] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)
  const [filterStale, setFilterStale] = useState<'overdue' | 'warning' | null>(null)
  const [activeGame, setActiveGame] = useState<GameType | 'all'>('all')

  const fetchContracts = async (forceRefresh = false) => {
    try {
      const url = forceRefresh ? '/api/contracts?refresh=true' : '/api/contracts'
      const res = await fetch(url)
      if (!res.ok) throw new Error('載入失敗')
      const data = await res.json() as { contracts: Contract[] }
      setContracts(data.contracts)
      setError('')
    } catch {
      setError('無法載入合約資料，請稍後再試')
    }
  }

  useEffect(() => {
    fetchContracts().finally(() => setLoading(false))
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchContracts(true)
    setRefreshing(false)
  }


  const handleGameChange = async (grNumber: string, game: GameType) => {
    setContracts(prev => prev.map(c => c.grNumber === grNumber ? { ...c, game } : c))
    await fetch(`/api/contracts/${grNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-game', game }),
    })
  }

  const filtered = useMemo(() => {
    setPage(1)
    return contracts.filter(c => {
      if (!showCancelled && c.status === '合約取消') return false
      if (activeGame !== 'all' && c.game !== activeGame) return false
      if (filterGame && c.game !== filterGame) return false
      if (filterStatus && c.status !== filterStatus) return false
      if (filterLegal && c.responsibleLegal !== filterLegal) return false
      if (filterStale === 'overdue' && (c.daysStale || 0) < 14) return false
      if (filterStale === 'warning' && ((c.daysStale || 0) < 7 || (c.daysStale || 0) >= 14)) return false
      if (search) {
        const q = search.toLowerCase()
        return c.grNumber.toLowerCase().includes(q) || c.partner.toLowerCase().includes(q)
      }
      return true
    })
  }, [contracts, showCancelled, activeGame, filterGame, filterStatus, filterLegal, search, filterStale])

  const sorted = useMemo(() => {
    if (!sortDir) return filtered
    return [...filtered].sort((a, b) => {
      const da = a.appliedAt ? new Date(a.appliedAt).getTime() : 0
      const db = b.appliedAt ? new Date(b.appliedAt).getTime() : 0
      return sortDir === 'asc' ? da - db : db - da
    })
  }, [filtered, sortDir])

  const handleSortApplied = () => {
    setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc')
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => {
    const base = activeGame === 'all' ? contracts : contracts.filter(c => c.game === activeGame)
    const active = base.filter(c => !['合約取消', '合約完成'].includes(c.status))
    return {
      total: active.length,
      overdue: active.filter(c => (c.daysStale || 0) >= 14).length,
      warning: active.filter(c => (c.daysStale || 0) >= 7 && (c.daysStale || 0) < 14).length,
    }
  }, [contracts, activeGame])

  const legalOptions = useMemo(() => {
    const set = new Set(contracts.map(c => c.responsibleLegal).filter(Boolean))
    return Array.from(set) as string[]
  }, [contracts])

  if (loading) return <LoadingSpinner text="正在從 Gmail 載入合約資料..." />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">合約總覽</h1>
          <p className="text-sm text-gray-500 mt-0.5">共 {stats.total} 份進行中</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-primary flex items-center gap-2 text-sm self-start"
        >
          {refreshing ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              更新中...
            </>
          ) : '同步郵件'}
        </button>
      </div>

      {/* Game Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {GAME_TABS.map(tab => {
          const count = tab.key === 'all'
            ? contracts.filter(c => !['合約取消', '合約完成'].includes(c.status)).length
            : contracts.filter(c => c.game === tab.key && !['合約取消', '合約完成'].includes(c.status)).length
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveGame(tab.key); setPage(1) }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeGame === tab.key
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                activeGame === tab.key ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'
              }`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Stats */}
      {(stats.overdue > 0 || stats.warning > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stats.overdue > 0 && (
            <button
              onClick={() => setFilterStale(f => f === 'overdue' ? null : 'overdue')}
              className={`card p-4 border-l-4 border-red-500 text-left transition-all hover:shadow-md ${filterStale === 'overdue' ? 'ring-2 ring-red-400 bg-red-50' : ''}`}
            >
              <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
              <p className="text-sm text-gray-500">逾期（14天+）</p>
              <p className="text-xs text-red-400 mt-1">{filterStale === 'overdue' ? '▼ 篩選中，點擊取消' : '點擊篩選'}</p>
            </button>
          )}
          {stats.warning > 0 && (
            <button
              onClick={() => setFilterStale(f => f === 'warning' ? null : 'warning')}
              className={`card p-4 border-l-4 border-yellow-400 text-left transition-all hover:shadow-md ${filterStale === 'warning' ? 'ring-2 ring-yellow-400 bg-yellow-50' : ''}`}
            >
              <p className="text-2xl font-bold text-yellow-600">{stats.warning}</p>
              <p className="text-sm text-gray-500">注意（7-13天）</p>
              <p className="text-xs text-yellow-500 mt-1">{filterStale === 'warning' ? '▼ 篩選中，點擊取消' : '點擊篩選'}</p>
            </button>
          )}
          <button
            onClick={() => setFilterStale(null)}
            className={`card p-4 border-l-4 border-orange-400 text-left transition-all hover:shadow-md ${filterStale === null ? '' : 'opacity-60 hover:opacity-100'}`}
          >
            <p className="text-2xl font-bold text-gray-700">{stats.total}</p>
            <p className="text-sm text-gray-500">進行中合約</p>
            <p className="text-xs text-gray-400 mt-1">點擊顯示全部</p>
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
      )}

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="搜尋合約編號或合作對象..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <select
            value={filterGame}
            onChange={e => setFilterGame(e.target.value as GameType | '')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            <option value="">所有遊戲</option>
            {GAME_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as ContractStatus | '')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            <option value="">所有狀態</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {legalOptions.length > 0 && (
            <select
              value={filterLegal}
              onChange={e => setFilterLegal(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            >
              <option value="">所有法務</option>
              {legalOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={e => setShowCancelled(e.target.checked)}
              className="rounded"
            />
            顯示已取消
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="text-xs" style={{ width: 'max-content', minWidth: '100%' }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-200">
                <Th>GR 編號</Th>
                <Th>遊戲</Th>
                <SortableTh dir={sortDir} onClick={handleSortApplied}>申請日期</SortableTh>
                <Th>負責法務</Th>
                <Th>合約狀態</Th>
                <Th>合作對象</Th>
                <Th>合作時間</Th>
                <Th>內容簡述</Th>
                <Th>類型</Th>
                <Th>負責人</Th>
                <Th>露出賽季</Th>
                <Th>贊助金額（NTD）</Th>
                <Th>我方提供</Th>
                <Th>對方提供</Th>
                <Th>下一步行動</Th>
                <Th>法務備註</Th>
                <Th>目前版本</Th>
                <Th>授權信</Th>
                <Th>最新郵件日期</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={20} className="px-4 py-12 text-center text-gray-400">
                    沒有符合條件的合約
                  </td>
                </tr>
              )}
              {paginated.map(c => <ContractRow key={c.grNumber} contract={c} onGameChange={handleGameChange} />)}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-gray-500">
            共 {filtered.length} 筆，第 {page} / {totalPages} 頁
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-2 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
            >上一頁</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-2 py-1 text-sm text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`px-3 py-1 text-sm rounded border ${page === p ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 hover:bg-gray-50'}`}
                  >{p}</button>
                )
              )}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
            >下一頁</button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-2 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
            >»</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap bg-gray-50 border-b border-gray-200 shadow-sm">
      {children}
    </th>
  )
}

function SortableTh({ children, dir, onClick }: { children: ReactNode; dir: 'asc' | 'desc' | null; onClick: () => void }) {
  return (
    <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap bg-gray-50 border-b border-gray-200 shadow-sm">
      <button
        onClick={onClick}
        className="flex items-center gap-1 hover:text-orange-600 transition-colors group"
        title="點擊排序"
      >
        {children}
        <span className="text-gray-300 group-hover:text-orange-400 transition-colors">
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '⇅'}
        </span>
      </button>
    </th>
  )
}

function NotesSummaryCell({ notes }: { notes: { content: string; author: string; createdAt: string }[] }) {
  const [expanded, setExpanded] = useState(false)
  if (notes.length === 0) return <span className="text-gray-400">-</span>
  const latest = notes[notes.length - 1]
  return (
    <div className="text-xs space-y-1">
      {(expanded ? notes : [latest]).map((n, i) => (
        <div key={i} className="bg-yellow-50 border border-yellow-100 rounded p-1.5">
          <span className="font-medium text-yellow-700">{n.author.split('@')[0]}</span>
          <span className="text-gray-400 ml-1">{new Date(n.createdAt).toLocaleDateString('zh-TW')}</span>
          <p className="text-gray-700 mt-0.5 break-words whitespace-pre-wrap">{n.content}</p>
        </div>
      ))}
      {notes.length > 1 && (
        <button onClick={() => setExpanded(e => !e)} className="text-orange-500 hover:text-orange-700 text-xs">
          {expanded ? '▲ 收起' : `▼ 全部 ${notes.length} 則`}
        </button>
      )}
    </div>
  )
}

function Td({ children, max = 80 }: { children?: string | null; max?: number }) {
  const [expanded, setExpanded] = useState(false)
  const text = children || ''
  if (!text) return <td className="px-3 py-2.5 text-gray-400 align-middle">-</td>
  const needsToggle = text.length > max
  return (
    <td className="px-3 py-2.5 text-gray-700 align-middle" style={{ maxWidth: '180px' }}>
      <div className={`whitespace-pre-wrap break-words leading-snug ${!expanded && needsToggle ? 'line-clamp-3' : ''}`}>
        {text}
      </div>
      {needsToggle && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-0.5 text-orange-500 hover:text-orange-700 text-xs whitespace-nowrap"
        >
          {expanded ? '▲ 收起' : '▼ 展開'}
        </button>
      )}
    </td>
  )
}

function ContractRow({ contract: c, onGameChange }: { contract: Contract; onGameChange: (grNumber: string, game: GameType) => void }) {
  return (
    <tr className={`hover:bg-orange-50 transition-colors ${c.status === '合約取消' ? 'opacity-40' : ''}`}>
      <td className="px-3 py-2 whitespace-nowrap">
        <Link href={`/dashboard/contract/${c.grNumber}`} className="font-mono font-semibold text-orange-600 hover:underline">
          {c.grNumber}
        </Link>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <select
          value={c.game}
          onChange={e => onGameChange(c.grNumber, e.target.value as GameType)}
          className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-300 bg-white"
        >
          {GAME_SELECT_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500">
        {c.appliedAt ? new Date(c.appliedAt).toLocaleDateString('zh-TW') : '-'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{c.responsibleLegal || '-'}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <StatusBadge status={c.status} locked={c.isManuallyLocked} />
          <StaleBadge days={c.daysStale || 0} />
        </div>
      </td>
      <Td>{c.partner}</Td>
      <Td>{c.cooperationPeriod}</Td>
      <Td>{c.description}</Td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{c.contractType || '-'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{c.responsiblePerson || '-'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{c.exposureSeason || '-'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{c.sponsorAmountNTD || '-'}</td>
      <Td>{c.ourProvisions}</Td>
      <Td>{c.theirProvisions}</Td>
      <Td>{c.nextAction}</Td>
      <td className="px-3 py-2.5 align-middle" style={{ maxWidth: '200px' }}>
        <NotesSummaryCell notes={c.notes || []} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{c.contractVersion || '-'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
        {c.hasAuthorizationLetter === undefined ? '-' : c.hasAuthorizationLetter ? '✓' : '✗'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500">
        {c.lastEmailAt ? new Date(c.lastEmailAt).toLocaleDateString('zh-TW') : '-'}
      </td>
    </tr>
  )
}
