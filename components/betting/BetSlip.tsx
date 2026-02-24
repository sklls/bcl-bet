'use client'

import { useState, useEffect } from 'react'
import { calculateOdds, calcPayout, formatOdds } from '@/lib/odds'

type BetOption = {
  id: string
  label: string
  total_amount_bet: number
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
  onClose,
  onSuccess,
}: {
  market: Market
  selectedOption: BetOption
  userBalance: number | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState('')
  const [previewOdds, setPreviewOdds] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    const num = parseFloat(amount)
    if (!isNaN(num) && num > 0) {
      const odds = calculateOdds(market.bet_options, selectedOption.id, num, market.house_edge_pct)
      setPreviewOdds(odds)
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
        window.location.reload() // refresh balance
      }, 1500)
    }
  }

  if (confirmed) {
    return (
      <div className="text-center py-4 text-green-400 font-semibold">
        Bet placed successfully!
      </div>
    )
  }

  const quickAmounts = [50, 100, 200, 500]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Backing: <span className="text-white font-medium">{selectedOption.label}</span>
        </p>
        {userBalance !== null && (
          <p className="text-xs text-gray-500">Balance: ₹{userBalance.toLocaleString()}</p>
        )}
      </div>

      {/* Quick amount buttons */}
      <div className="flex gap-2">
        {quickAmounts.map((q) => (
          <button
            key={q}
            onClick={() => setAmount(String(q))}
            className="flex-1 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
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
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
        />
      </div>

      {previewOdds !== null && parseFloat(amount) > 0 && (
        <div className="bg-gray-800 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-400">
            <span>Odds</span>
            <span className="text-yellow-400 font-bold">{formatOdds(previewOdds)}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Stake</span>
            <span>₹{parseFloat(amount).toLocaleString()}</span>
          </div>
          <div className="flex justify-between font-semibold text-white border-t border-gray-700 pt-1 mt-1">
            <span>Potential return</span>
            <span className="text-green-400">₹{calcPayout(parseFloat(amount), previewOdds).toLocaleString()}</span>
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handlePlaceBet}
          disabled={loading || !amount || parseFloat(amount) <= 0}
          className="flex-1 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
        >
          {loading ? 'Placing...' : 'Confirm Bet'}
        </button>
      </div>
    </div>
  )
}
