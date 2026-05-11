'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { GameBadge } from '@/components/StatusBadge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import type { Contract } from '@/types'

interface FinanceContract extends Contract {
  invoiceAppliedAt?: string
  invoiceIssuedAt?: string
  invoiceAmount?: string
}

export default function FinancePage() {
  const [contracts, setContracts] = useState<FinanceContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/contracts')
      .then(r => r.json())
      .then(data => {
        const all = (data.contracts || []) as FinanceContract[]
        setContracts(all.filter(c =>
          c.sponsorAmountNTD || c.sponsorAmountUSD || c.financeConfirmed ||
          c.status !== '法務尚未回覆'
        ))
      })
      .catch(() => setError('無法載入財務資料'))
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => {
    const total = contracts.length
    const financeConfirmed = contracts.filter(c => c.financeConfirmed).length
    const financeNotConfirmed = contracts.filter(c => !c.financeConfirmed && !['合約取消', '合約完成'].includes(c.status)).length
    return { total, financeConfirmed, financeNotConfirmed }
  }, [contracts])

  if (loading) return <LoadingSpinner text="載入財務資料..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">財務追蹤</h1>
        <p className="text-sm text-gray-500 mt-0.5">合約金流、付款條件與發票狀態</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
          <p className="text-sm text-gray-500">涉及金流合約</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-green-600">{stats.financeConfirmed}</p>
          <p className="text-sm text-gray-500">財務已確認</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-orange-500">{stats.financeNotConfirmed}</p>
          <p className="text-sm text-gray-500">待財務確認</p>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">合約編號</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">遊戲</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">合作對象</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">贊助金額 NTD</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">贊助金額 USD</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">財務確認</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">發票申請</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">發票開立</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contracts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    尚無財務相關合約資料
                  </td>
                </tr>
              ) : (
                contracts.map(c => (
                  <tr key={c.grNumber} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/dashboard/contract/${c.grNumber}`}
                        className="font-mono font-medium text-orange-600 hover:underline"
                      >
                        {c.grNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <GameBadge game={c.game} />
                    </td>
                    <td className="px-4 py-3 max-w-[160px] truncate">{c.partner}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium">
                      {c.sponsorAmountNTD ? `NT$ ${c.sponsorAmountNTD}` : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.sponsorAmountUSD ? `$${c.sponsorAmountUSD}` : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`font-medium ${c.financeConfirmed ? 'text-green-600' : 'text-orange-500'}`}>
                        {c.financeConfirmed ? '✓ 已確認' : '待確認'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                      {c.invoiceAppliedAt
                        ? new Date(c.invoiceAppliedAt).toLocaleDateString('zh-TW')
                        : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                      {c.invoiceIssuedAt
                        ? new Date(c.invoiceIssuedAt).toLocaleDateString('zh-TW')
                        : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center">
        發票資料自動從 Garena 發票開立申請單回條讀取
      </p>
    </div>
  )
}
