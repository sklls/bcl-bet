'use client'

import { useState } from 'react'
import { formatCredits } from '@/lib/credits'

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
  const [loading, setLoading] = useState<'cash' | 'season' | null>(null)

  async function handleReset(type: 'cash' | 'season') {
    if (type === 'cash') {
      if (!window.confirm(
        'Reset "Total Credits Issued" to 0 CR?\n\nThis deletes all top-up transaction records. Wallets and bet history are NOT affected.'
      )) return

      setLoading('cash')
      setMsg('')
      try {
        const res = await fetch('/api/admin/reset-financials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'cash' }),
        })
        const data = await res.json()
        if (res.ok) {
          setMsg('✅ Credits-issued counter reset to 0 CR.')
          setMsgType('success')
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
      return
    }

    // Season reset
    const input = window.prompt(
      '⚠️ SEASON RESET ⚠️\n\nThis will:\n• Delete ALL matches, markets, bets\n• Delete ALL teams\n• Zero ALL user wallets\n• Delete ALL transactions\n\nThis CANNOT be undone. Type RESET SEASON to confirm.'
    )
    if (input !== 'RESET SEASON') {
      setMsg('Reset cancelled.')
      setMsgType('error')
      return
    }

    setLoading('season')
    setMsg('')
    try {
      const res = await fetch('/api/admin/reset-season', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setMsg('✅ Season reset complete. All matches, teams, and transactions cleared.')
        setMsgType('success')
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
            className="px-3 py-1.5 text-xs font-medium bg-raised hover:bg-rail text-slate border border-rail rounded-lg transition-colors disabled:opacity-50"
          >
            {loading === 'cash' ? 'Resetting…' : 'Reset Issued Counter'}
          </button>
          <button
            onClick={() => handleReset('season')}
            disabled={loading !== null}
            className="px-3 py-1.5 text-xs font-medium bg-crimson/10 hover:bg-crimson/20 text-crimson-light border border-crimson/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading === 'season' ? 'Resetting…' : '🔄 Season Reset'}
          </button>
        </div>
      </div>

      {msg && (
        <p className={`text-sm mb-3 px-3 py-2 rounded-lg ${msgType === 'success' ? 'bg-amber/10 text-amber' : 'bg-crimson/10 text-crimson-light'}`}>
          {msg}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-table border border-rail rounded-xl p-4">
          <p className="text-xs text-slate mb-1">Total Credits Issued</p>
          <p className="text-xl font-bold text-slate">{formatCredits(totalCashIn)}</p>
          <p className="text-xs text-slate mt-1">via top-ups</p>
        </div>
        <div className="bg-table border border-rail rounded-xl p-4">
          <p className="text-xs text-slate mb-1">Total Staked</p>
          <p className="text-xl font-bold text-white">{formatCredits(totalStaked)}</p>
          <p className="text-xs text-slate mt-1">settled bets only</p>
        </div>
        <div className="bg-table border border-rail rounded-xl p-4">
          <p className="text-xs text-slate mb-1">Total Paid Out</p>
          <p className="text-xl font-bold text-amber">{formatCredits(totalPaidOut)}</p>
          <p className="text-xs text-slate mt-1">to winners</p>
        </div>
        <div className="bg-table border border-rail rounded-xl p-4">
          <p className="text-xs text-slate mb-1">House Edge Kept</p>
          <p className="text-xl font-bold text-gold">{formatCredits(houseEdge)}</p>
          <p className="text-xs text-slate mt-1">{houseEdgePct}% of staked</p>
        </div>
      </div>

      {totalStaked > 0 && (
        <div className="mt-4 bg-table border border-rail rounded-xl p-4">
          <div className="flex justify-between text-xs text-slate mb-2">
            <span>Payout Rate</span>
            <span>{(100 - parseFloat(houseEdgePct)).toFixed(1)}% paid out · {houseEdgePct}% kept</span>
          </div>
          <div className="w-full bg-rail rounded-full h-3 overflow-hidden">
            <div
              className="h-3 bg-amber rounded-full"
              style={{ width: `${Math.max(0, 100 - parseFloat(houseEdgePct))}%` }}
            />
          </div>
          <div className="flex justify-between text-xs mt-2">
            <span className="text-amber">{formatCredits(totalPaidOut)} paid out</span>
            <span className="text-gold">{formatCredits(houseEdge)} house edge</span>
          </div>
        </div>
      )}

      <div className="mt-3 text-xs text-slate space-y-0.5">
        <p><span className="text-slate">Reset Issued Counter</span> — clears top-up records only. Wallets &amp; bets untouched.</p>
        <p><span className="text-crimson-light">Season Reset</span> — deletes all matches, teams, transactions; zeros all wallets.</p>
      </div>
    </div>
  )
}
