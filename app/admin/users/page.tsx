'use client'

import { useEffect, useState } from 'react'
import { formatCredits } from '@/lib/credits'

type User = {
  id: string
  display_name: string
  wallet_balance: number
  role: string
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<User | null>(null)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')

  async function loadUsers() {
    const res = await fetch('/api/admin/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  async function handleTopup(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setMsg('')
    const res = await fetch('/api/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_user_id: selected.id,
        amount: parseFloat(amount),
        description: description || undefined,
      }),
    })
    if (res.ok) {
      setMsg(`Topped up ${formatCredits(amount)} for ${selected.display_name}`)
      setMsgType('success')
      setAmount('')
      setDescription('')
      setSelected(null)
      loadUsers()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error')
      setMsgType('error')
    }
  }

  async function handleReset(user: User) {
    if (!confirm(`Reset ${user.display_name}'s wallet to 0 CR? This cannot be undone.`)) return
    setMsg('')
    const res = await fetch(`/api/admin/users?id=${user.id}`, { method: 'DELETE' })
    if (res.ok) {
      setMsg(`Wallet reset to 0 CR for ${user.display_name}`)
      setMsgType('success')
      loadUsers()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error resetting wallet')
      setMsgType('error')
    }
  }

  if (loading) return <div className="text-slate py-10 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Wallets</h1>
        <p className="text-slate text-sm mt-1">Issue in-game credits to a player</p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm border ${
          msgType === 'success'
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-crimson/10 border-crimson/30 text-crimson-light'
        }`}>{msg}</div>
      )}

      {/* Top-up form */}
      {selected && (
        <form onSubmit={handleTopup} className="bg-table border border-green-500/30 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-white">
            Top up: <span className="text-green-400">{selected.display_name}</span>
          </h2>
          <p className="text-sm text-slate">Current balance: {formatCredits(Number(selected.wallet_balance))}</p>
          <input
            required
            type="number"
            min="1"
            placeholder="Amount (CR)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 bg-rail rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            placeholder="Note (e.g. Cash received 24 Feb)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 bg-rail rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium">
              Add {formatCredits(amount || '0')} to Wallet
            </button>
            <button type="button" onClick={() => setSelected(null)} className="px-4 py-2 bg-raised text-white rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Users table */}
      <div className="bg-table border border-rail rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rail text-slate text-xs uppercase">
              <th className="text-left px-4 py-3">User</th>
              <th className="text-right px-4 py-3">Balance</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-rail/50">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{u.display_name}</p>
                  <p className="text-xs text-slate capitalize">{u.role}</p>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-green-400">
                  {formatCredits(Number(u.wallet_balance))}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => { setSelected(u); setAmount(''); setDescription('') }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                    >
                      Top Up
                    </button>
                    <button
                      onClick={() => handleReset(u)}
                      className="px-3 py-1 bg-crimson/20 hover:bg-crimson/40 text-crimson-light rounded text-xs font-medium"
                    >
                      Reset
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="text-center text-slate py-10">No users registered yet.</p>
        )}
      </div>
    </div>
  )
}
