'use client'

import { useState } from 'react'

type Props = {
  totalCashIn: number
  totalStaked: number
  totalPaidOut: number
  houseEdge: number
  houseEdgePct: string
}

export default function FinancialOverview({
  totalCashIn,
  totalStaked,
  totalPaidOut,
  houseEdge,
  houseEdgePct,
}: Props) {
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')
  const [loading, setLoading] = useState<'cash' | 'full' | null>(null)

  async function handleReset(type: 'cash' | 'full') {
    const confirmMsg =
      type === 'cash'
        ? 'Reset "Total Cash Collected" to ₹0?\n\nThis deletes all top-up transaction records. Wallets and bet history are NOT affected.'
        : '⚠️ FULL FINANCIAL RESET ⚠️\n\nThis will:\n• Zero ALL user wallets\n• Delete ALL transactions\n• Void all pending bets\n\nThis CANNOT be undone. Type RESET to confirm.'

    if (type === 'full') {
      const input = window.prompt(confirmMsg)
      if (input !== 'RESET') {
        setMsg('Reset cancelled.')
        setMsgType('error')
        return
      }
    } else {
      if (!window.confirm(confirmMsg)) return
    }

    setLoading(type)
    setMsg('')

    try {
      const res = await fetch('/api/admin/reset-financials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg(
          type === 'cash'
            ? '✅ Cash collected counter reset to ₹0.'
            : '✅ Full financial reset complete. All wallets zeroed, transactions cleared.'
        )
        setMsgType('success')
        // Hard reload so server component re-fetches fresh data from DB
        setTimeout(() => window.location.reload(), 800)
      } else {
        setMsg(`Error: ${data.error ?? JSON.stringify(data)}`)
        setMsgType('error')
      }
    } catch (err) {
      setMsg(`Network error: ${String(err)}`)
      setMsgType('error')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">💰 Financial Overview</h2>
        <div className="flex gap-2">
          <button
            onClick={() => handleReset('cash')}
            disabled={loading !== null}
            className="px-3 py-1.5 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading === 'cash' ? 'Resetting…' : 'Reset Cash Counter'}
          </button>
          <button
            onClick={() => handleReset('full')}
            disabled={loading !== null}
            className="px-3 py-1.5 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading === 'full' ? 'Resetting…' : '🗑 Full Reset'}
          </button>
        </div>
      </div>

      {msg && (
        <p className={`text-sm mb-3 px-3 py-2 rounded-lg ${msgType === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {msg}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Cash Collected</p>
          <p className="text-xl font-bold text-blue-400">₹{totalCashIn.toLocaleString('en-IN')}</p>
          <p className="text-xs text-gray-600 mt-1">via top-ups</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Staked</p>
          <p className="text-xl font-bold text-white">₹{totalStaked.toLocaleString('en-IN')}</p>
          <p className="text-xs text-gray-600 mt-1">settled bets only</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Paid Out</p>
          <p className="text-xl font-bold text-green-400">₹{totalPaidOut.toLocaleString('en-IN')}</p>
          <p className="text-xs text-gray-600 mt-1">to winners</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">House Edge Kept</p>
          <p className="text-xl font-bold text-yellow-400">₹{houseEdge.toLocaleString('en-IN')}</p>
          <p className="text-xs text-gray-600 mt-1">{houseEdgePct}% of staked</p>
        </div>
      </div>

      {totalStaked > 0 && (
        <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex justify-between text-xs text-gray-400 mb-2">
            <span>Payout Rate</span>
            <span>{(100 - parseFloat(houseEdgePct)).toFixed(1)}% paid out · {houseEdgePct}% kept</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 bg-green-500 rounded-full"
              style={{ width: `${Math.max(0, 100 - parseFloat(houseEdgePct))}%` }}
            />
          </div>
          <div className="flex justify-between text-xs mt-2">
            <span className="text-green-400">₹{totalPaidOut.toLocaleString('en-IN')} paid out</span>
            <span className="text-yellow-400">₹{houseEdge.toLocaleString('en-IN')} house edge</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 text-xs text-gray-600 space-y-0.5">
        <p><span className="text-blue-400">Reset Cash Counter</span> — clears top-up records only. Wallets &amp; bets untouched.</p>
        <p><span className="text-red-400">Full Reset</span> — zeros all wallets, deletes all transactions, voids pending bets.</p>
      </div>
    </div>
  )
}
