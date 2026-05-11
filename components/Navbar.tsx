'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'

const NAV_ITEMS = [
  { href: '/dashboard', label: '合約總覽', icon: '📋' },
  { href: '/dashboard/query', label: '郵件查詢', icon: '🔍' },
  { href: '/dashboard/finance', label: '財務追蹤', icon: '💰' },
  { href: '/dashboard/settings', label: '人員設定', icon: '⚙️' },
]

export function Navbar() {
  const pathname = usePathname()
  const { data: session } = useSession()

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 font-bold text-gray-900">
              <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center">
                <span className="text-white text-xs font-bold">BD</span>
              </div>
              <span className="hidden sm:block text-sm">合約追蹤</span>
            </Link>

            {/* Nav Links */}
            <div className="flex items-center gap-1">
              {NAV_ITEMS.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                      ? 'bg-orange-50 text-orange-600'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span className="hidden md:block">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* User */}
          <div className="flex items-center gap-3">
            {session?.user?.email && (
              <span className="hidden sm:block text-xs text-gray-400 truncate max-w-[180px]">
                {session.user.email}
              </span>
            )}
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              登出
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
