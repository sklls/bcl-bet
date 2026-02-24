'use client'

import { useEffect, useState } from 'react'

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

  async function loadUsers() {
    // Fetch all non-admin users via a simple supabase call
    // We expose this through a dedicated admin route
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
      setMsg(`Topped up ₹${amount} for ${selected.display_name}`)
      setAmount('')
      setDescription('')
      setSelected(null)
      loadUsers()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error')
    }
  }

  if (loading) return <div className="text-gray-400 py-10 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Wallets</h1>
        <p className="text-gray-400 text-sm mt-1">Top up user balances after receiving cash</p>
      </div>

      {msg && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg px-4 py-2 text-sm">{msg}</div>
      )}

      {/* Top-up form */}
      {selected && (
        <form onSubmit={handleTopup} className="bg-gray-900 border border-green-500/30 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-white">
            Top up: <span className="text-green-400">{selected.display_name}</span>
          </h2>
          <p className="text-sm text-gray-400">Current balance: ₹{Number(selected.wallet_balance).toLocaleString()}</p>
          <input
            required
            type="number"
            min="1"
            placeholder="Amount (₹)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            placeholder="Note (e.g. Cash received 24 Feb)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium">
              Add ₹{amount || '0'} to Wallet
            </button>
            <button type="button" onClick={() => setSelected(null)} className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Users table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase">
              <th className="text-left px-4 py-3">User</th>
              <th className="text-right px-4 py-3">Balance</th>
              <th className="text-right px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{u.display_name}</p>
                  <p className="text-xs text-gray-500 capitalize">{u.role}</p>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-green-400">
                  ₹{Number(u.wallet_balance).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => { setSelected(u); setAmount(''); setDescription('') }}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                  >
                    Top Up
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="text-center text-gray-500 py-10">No users registered yet.</p>
        )}
      </div>
    </div>
  )
}
