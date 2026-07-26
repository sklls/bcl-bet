'use client'

import { useState, useEffect } from 'react'
import { projectedOdds, projectedReturn, formatOdds } from '@/lib/parimutuel'

type BetOption = {
  id: string
  label: string
  total_amount_bet: number
  seed_amount: number
}

type Market = {
  id: string
  house_edge_pct: number
  bet_options: BetOption[]
}

export default function BetSlip({
  market,
  selectedOption,
  userBalance,
  marketCreatedAt,
  onClose,
  onSuccess,
}: {
  market: Market
  selectedOption: BetOption
  userBalance: number | null
  marketCreatedAt?: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState('')
  const [previewOdds, setPreviewOdds] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const isEarlyBird = marketCreatedAt
    ? new Date() < new Date(new Date(marketCreatedAt).getTime() + 30 * 60 * 1000)
    : false

  useEffect(() => {
    const num = parseFloat(amount)
    if (!isNaN(num) && num > 0) {
      setPreviewOdds(projectedOdds(market.bet_options, selectedOption.id, market.house_edge_pct, num))
    } else {
      setPreviewOdds(null)
    }
  }, [amount, market.bet_options, selectedOption.id, market.house_edge_pct])

  async function handlePlaceBet() {
    const num = parseFloat(amount)
    if (isNaN(num) || num <= 0) return setError('Enter a valid amount')
    if (userBalance !== null && num > userBalance) return setError('Insufficient balance')

    setError('')
    setLoading(true)

    const res = await fetch('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market_id: market.id,
        bet_option_id: selectedOption.id,
        amount: num,
      }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Failed to place bet')
    } else {
      setConfirmed(true)
      setTimeout(() => {
        onSuccess()
        window.location.reload()
      }, 1500)
    }
  }

  if (confirmed) {
    return (
      <div className="text-center py-4 text-amber font-semibold">
        Bet placed successfully!
      </div>
    )
  }

  const quickAmounts = [50, 100, 200, 500]

  return (
    <div className="space-y-3">
      {isEarlyBird && (
        <div className="bg-gold/10 border border-gold/30 rounded-lg px-3 py-2 text-xs text-gold flex items-center gap-2">
          <span>⚡</span>
          <span>Early bird! Bets in the first 30 min count as <strong>up to 1.1×</strong> when the pool is shared out.</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate">
          Backing: <span className="text-white font-medium">{selectedOption.label}</span>
        </p>
        {userBalance !== null && (
          <p className="text-xs text-slate">Balance: ₹{userBalance.toLocaleString()}</p>
        )}
      </div>

      <div className="flex gap-2">
        {quickAmounts.map((q) => (
          <button
            key={q}
            onClick={() => setAmount(String(q))}
            className="flex-1 py-1 text-xs bg-raised hover:bg-rail rounded text-slate transition-colors"
          >
            ₹{q}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <input
          type="number"
          min="1"
          placeholder="Enter amount (₹)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="flex-1 px-3 py-2 bg-baize border border-rail rounded-lg text-white placeholder-slate-faded focus:outline-none focus:ring-2 focus:ring-amber text-sm"
        />
      </div>

      {previewOdds !== null && parseFloat(amount) > 0 && (
        <div className="bg-baize rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-slate">
            <span>Projected odds</span>
            <span className="text-gold font-bold">{formatOdds(previewOdds)}</span>
          </div>
          <div className="flex justify-between text-slate">
            <span>Stake</span>
            <span>₹{parseFloat(amount).toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between font-semibold text-white border-t border-rail pt-1 mt-1">
            <span>Projected return</span>
            <span className="text-amber">
              ~₹{projectedReturn(parseFloat(amount), previewOdds).toLocaleString('en-IN')}
            </span>
          </div>
          <p className="text-[11px] text-slate pt-1 leading-snug">
            Winners share the pool. Your final payout depends on how much is
            backing this option when the market closes, so this figure will move.
          </p>
        </div>
      )}

      {error && <p className="text-crimson-light text-sm">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-2 bg-raised hover:bg-rail text-slate rounded-lg text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handlePlaceBet}
          disabled={loading || !amount || parseFloat(amount) <= 0}
          className="flex-1 py-2 bg-amber hover:bg-amber-deep disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
        >
          {loading ? 'Placing...' : 'Confirm Bet'}
        </button>
      </div>
    </div>
  )
}
