'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import BetSlip from './BetSlip'
import { calculateOdds, formatOdds } from '@/lib/odds'

type BetOption = {
  id: string
  label: string
  total_amount_bet: number
}

type Market = {
  id: string
  market_type: string
  title: string | null
  status: string
  house_edge_pct: number
  result: string | null
  created_at: string
  bet_options: BetOption[]
}

type Bettor = { name: string; early: boolean }

const MARKET_LABELS: Record<string, string> = {
  winner: 'Match Winner',
  top_scorer: 'Top Scorer',
  over_under: 'Over / Under',
  live: 'Live Market',
}

function getMarketLabel(market: Market): string {
  if (market.title) return market.title
  return MARKET_LABELS[market.market_type] ?? market.market_type
}

export default function MarketsSection({
  initialMarkets,
  matchId,
  userBalance,
}: {
  initialMarkets: Market[]
  matchId: string
  userBalance: number | null
}) {
  const [markets, setMarkets] = useState<Market[]>(initialMarkets)
  const [selectedOption, setSelectedOption] = useState<{ marketId: string; option: BetOption } | null>(null)
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set())
  const [bettors, setBettors] = useState<Record<string, Record<string, Bettor[]>>>({})
  const supabase = createClient()

  function fetchBettors(marketId: string) {
    fetch(`/api/markets/${marketId}/bettors`)
      .then(r => r.json())
      .then(data => setBettors(prev => ({ ...prev, [marketId]: data.bettors ?? {} })))
      .catch(() => {})
  }

  function toggleExpand(marketId: string) {
    setExpandedMarkets(prev => {
      const next = new Set(prev)
      if (next.has(marketId)) {
        next.delete(marketId)
      } else {
        next.add(marketId)
        if (!bettors[marketId]) fetchBettors(marketId)
      }
      return next
    })
  }

  // Realtime subscription for odds updates
  useEffect(() => {
    const channel = supabase
      .channel(`markets-${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bet_options' },
        (payload) => {
          const updated = payload.new as BetOption
          setMarkets((prev) =>
            prev.map((market) => ({
              ...market,
              bet_options: market.bet_options.map((o) =>
                o.id === updated.id ? { ...o, total_amount_bet: updated.total_amount_bet } : o
              ),
            }))
          )
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'markets' },
        (payload) => {
          const updated = payload.new as Partial<Market>
          setMarkets((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [matchId])

  return (
    <div className="space-y-3">
      {markets.map((market) => {
        const isExpanded = expandedMarkets.has(market.id)
        const marketBettors = bettors[market.id] ?? {}

        return (
        <div key={market.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Header — always visible, clickable to expand/collapse */}
          <div
            className="flex items-center justify-between px-5 py-4 cursor-pointer select-none"
            onClick={() => toggleExpand(market.id)}
          >
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-xs">{isExpanded ? '▾' : '▸'}</span>
              <h3 className="font-semibold text-white">{getMarketLabel(market)}</h3>
              <span className="text-xs text-gray-500">{market.bet_options.length} options</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              market.status === 'open' ? 'bg-green-500/20 text-green-400' :
              market.status === 'settled' ? 'bg-gray-700 text-gray-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>
              {market.status === 'open' ? 'Betting Open' :
               market.status === 'settled' ? `Settled: ${market.result}` : 'Closed'}
            </span>
          </div>

          {/* Bet options — only shown when expanded */}
          {isExpanded && (
            <div className="px-5 pb-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {market.bet_options.map((option) => {
                  const odds = calculateOdds(market.bet_options, option.id, 1, market.house_edge_pct)
                  const isSelected = selectedOption?.option.id === option.id
                  const isWinner = market.result === option.label
                  const optionBettors = marketBettors[option.id] ?? []

                  return (
                    <button
                      key={option.id}
                      disabled={market.status !== 'open'}
                      onClick={(e) => { e.stopPropagation(); setSelectedOption(isSelected ? null : { marketId: market.id, option }) }}
                      className={`rounded-lg p-3 border text-left transition-all ${
                        isWinner ? 'border-green-500 bg-green-500/10' :
                        isSelected ? 'border-green-400 bg-green-400/10' :
                        market.status === 'open'
                          ? 'border-gray-700 hover:border-gray-500 bg-gray-800'
                          : 'border-gray-800 bg-gray-800/50 opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <p className="text-sm font-medium text-white truncate">{option.label}</p>
                      <p className={`text-lg font-bold mt-0.5 ${isWinner ? 'text-green-400' : 'text-yellow-400'}`}>
                        {formatOdds(odds)}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Pool: ₹{Number(option.total_amount_bet).toLocaleString('en-IN')}
                      </p>
                      {/* Who's betting here */}
                      {optionBettors.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-gray-700/50 flex flex-wrap gap-x-1.5 gap-y-0.5">
                          {optionBettors.slice(0, 4).map((b, i) => (
                            <span key={i} className={`text-[10px] ${b.early ? 'text-yellow-400' : 'text-gray-500'}`}>
                              {b.early ? '⚡' : ''}{b.name.split(' ')[0]}
                            </span>
                          ))}
                          {optionBettors.length > 4 && (
                            <span className="text-[10px] text-gray-600">+{optionBettors.length - 4}</span>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {selectedOption?.marketId === market.id && (
                <div className="mt-4 pt-4 border-t border-gray-700">
                  <BetSlip
                    market={market}
                    selectedOption={selectedOption.option}
                    userBalance={userBalance}
                    marketCreatedAt={market.created_at}
                    onClose={() => setSelectedOption(null)}
                    onSuccess={() => {
                      setSelectedOption(null)
                      fetchBettors(market.id)
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        )
      })}

      {markets.length === 0 && (
        <p className="text-gray-500 text-center py-8">No betting markets available for this match.</p>
      )}
    </div>
  )
}
