'use client'

import { useState, useEffect } from 'react'

type Role = '法務' | '財務' | 'BD' | '系統'

interface TeamMember {
  id: number
  email: string
  displayName: string
  role: Role
}

const ROLES: Role[] = ['BD', '法務', '財務', '系統']

const ROLE_COLORS: Record<Role, string> = {
  BD:   'bg-orange-100 text-orange-700',
  法務: 'bg-blue-100 text-blue-700',
  財務: 'bg-purple-100 text-purple-700',
  系統: 'bg-gray-100 text-gray-500',
}

export default function SettingsPage() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ email: '', displayName: '', role: 'BD' as Role })
  const [addForm, setAddForm] = useState({ email: '', displayName: '', role: 'BD' as Role })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings/team')
      .then(r => r.json())
      .then(d => { if (d.members) setMembers(d.members) })
      .finally(() => setLoading(false))
  }, [])

  const handleAdd = async () => {
    if (!addForm.email || !addForm.displayName) return
    setAdding(true)
    setError('')
    try {
      const res = await fetch('/api/settings/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setMembers(prev => [...prev, data.member])
      setAddForm({ email: '', displayName: '', role: 'BD' })
    } finally {
      setAdding(false)
    }
  }

  const handleEdit = (m: TeamMember) => {
    setEditId(m.id)
    setEditForm({ email: m.email, displayName: m.displayName, role: m.role })
  }

  const handleSave = async () => {
    if (editId === null) return
    await fetch('/api/settings/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId, ...editForm }),
    })
    setMembers(prev => prev.map(m => m.id === editId ? { ...m, ...editForm } : m))
    setEditId(null)
  }

  const handleDelete = async (id: number) => {
    await fetch('/api/settings/team', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setMembers(prev => prev.filter(m => m.id !== id))
  }

  const grouped = ROLES.reduce<Record<Role, TeamMember[]>>((acc, r) => {
    acc[r] = members.filter(m => m.role === r)
    return acc
  }, { BD: [], 法務: [], 財務: [], 系統: [] })

  if (loading) return <div className="text-gray-400 text-sm p-8">載入中...</div>

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">人員設定</h1>
        <p className="text-sm text-gray-500 mt-0.5">管理各角色的 email，同步郵件時會依此辨識寄件者身份</p>
      </div>

      {/* 新增人員 */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-4">新增人員</h2>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            placeholder="email@garena.com"
            value={addForm.email}
            onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
            className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <input
            type="text"
            placeholder="顯示名稱"
            value={addForm.displayName}
            onChange={e => setAddForm(f => ({ ...f, displayName: e.target.value }))}
            className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <select
            value={addForm.role}
            onChange={e => setAddForm(f => ({ ...f, role: e.target.value as Role }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={handleAdd}
            disabled={adding || !addForm.email || !addForm.displayName}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {adding ? '新增中...' : '+ 新增'}
          </button>
        </div>
      </div>

      {/* 人員清單 */}
      {ROLES.filter(r => grouped[r].length > 0 || r !== '系統').map(r => (
        <div key={r} className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded font-semibold ${ROLE_COLORS[r]}`}>{r}</span>
            <span className="text-gray-400 text-sm font-normal">{grouped[r].length} 人</span>
          </h2>
          {grouped[r].length === 0 ? (
            <p className="text-gray-400 text-sm">尚未設定</p>
          ) : (
            <div className="space-y-2">
              {grouped[r].map(m => (
                <div key={m.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  {editId === m.id ? (
                    <>
                      <input
                        value={editForm.email}
                        onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-300"
                      />
                      <input
                        value={editForm.displayName}
                        onChange={e => setEditForm(f => ({ ...f, displayName: e.target.value }))}
                        className="w-24 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-300"
                      />
                      <select
                        value={editForm.role}
                        onChange={e => setEditForm(f => ({ ...f, role: e.target.value as Role }))}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        {ROLES.map(ro => <option key={ro} value={ro}>{ro}</option>)}
                      </select>
                      <button onClick={handleSave} className="text-sm text-green-600 hover:text-green-800 font-medium">儲存</button>
                      <button onClick={() => setEditId(null)} className="text-sm text-gray-400 hover:text-gray-600">取消</button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-gray-700 font-mono flex-1 truncate">{m.email}</span>
                      <span className="text-sm text-gray-900 font-medium w-20 shrink-0">{m.displayName}</span>
                      <button onClick={() => handleEdit(m)} className="text-xs text-gray-400 hover:text-orange-500 transition-colors">編輯</button>
                      <button onClick={() => handleDelete(m.id)} className="text-xs text-gray-300 hover:text-red-400 transition-colors">✕</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="card p-4 bg-blue-50 border-blue-100 text-sm text-blue-700">
        <strong>辨識邏輯說明：</strong>同步郵件時，系統依此清單判斷每封信的寄件人角色。
        不在清單中的 <code>@garena.com</code> 視為 BD，<code>@sea.com</code> 視為財務，其他網域視為品牌方（其他）。
        設定後需重新「同步郵件」才會更新辨識結果。
      </div>
    </div>
  )
}
