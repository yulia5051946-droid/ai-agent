import type { ContractStatus } from '@/types'

function getStatusStyle(status: string): string {
  if (status === '合約取消') return 'bg-gray-100 text-gray-500'
  if (status === '合約完成') return 'bg-green-100 text-green-700'
  if (status === '已提供最終清稿待用印') return 'bg-teal-100 text-teal-700'
  if (status === '確定法務負責人') return 'bg-blue-100 text-blue-700'
  if (status === '待財務確認') return 'bg-purple-100 text-purple-700'
  if (status.startsWith('法務已提供')) return 'bg-indigo-100 text-indigo-700'
  if (status.startsWith('已提供')) return 'bg-yellow-100 text-yellow-700'
  if (status.startsWith('品牌已反饋')) return 'bg-cyan-100 text-cyan-700'
  if (status === '法務尚未回覆') return 'bg-orange-100 text-orange-700'
  return 'bg-gray-100 text-gray-600'
}

export function StatusBadge({ status, locked }: { status: ContractStatus; locked?: boolean }) {
  return (
    <span className={`badge ${getStatusStyle(status as string)}`}>
      {locked && <span className="mr-1">🔒</span>}
      {status}
    </span>
  )
}

export function StaleBadge({ days }: { days: number }) {
  if (days < 7) return null
  if (days >= 14) {
    return (
      <span className="badge bg-red-100 text-red-700 ml-1">
        逾期 {days}天
      </span>
    )
  }
  return (
    <span className="badge bg-yellow-100 text-yellow-700 ml-1">
      注意 {days}天
    </span>
  )
}

export function FinanceBadge({ confirmed }: { confirmed?: boolean }) {
  if (confirmed === undefined) return null
  if (confirmed) {
    return (
      <span className="badge bg-emerald-100 text-emerald-700 ml-1" title="財務已確認">
        財務✓
      </span>
    )
  }
  return (
    <span className="badge bg-purple-100 text-purple-600 ml-1" title="財務尚未確認">
      財務待確
    </span>
  )
}

export function GameBadge({ game }: { game: string }) {
  const styles: Record<string, string> = {
    AOV: 'bg-indigo-100 text-indigo-700',
    DF: 'bg-teal-100 text-teal-700',
    CODM: 'bg-rose-100 text-rose-700',
    unknown: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`badge ${styles[game] || styles.unknown}`}>
      {game}
    </span>
  )
}
