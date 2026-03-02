'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'

type Match = {
  id: string
  team_a: string
  team_b: string
  match_date: string
  status: string
}

type OverallPlayer = {
  id: string
  display_name: string
  total_winnings: number
  bets_won: number
  total_bets: number
  wallet_balance: number
}

type MatchPlayer = {
  display_name: string
  total_staked: number
  total_winnings: number
  net_pl: number
  total_bets: number
  bets_won: number
}

const rankColor = (idx: number) =>
  idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-600' : 'text-gray-500'

const rankMedal = (idx: number) =>
  idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`

export default function LeaderboardClient({
  matches,
  overall,
}: {
  matches: Match[]
  overall: OverallPlayer[]
}) {
  const [tab, setTab] = useState<'match' | 'overall'>('overall')
  const [selectedMatchId, setSelectedMatchId] = useState(matches[0]?.id ?? '')
  const [matchPlayers, setMatchPlayers] = useState<MatchPlayer[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'match' || !selectedMatchId) return
    setLoading(true)
    setMatchPlayers([])
    fetch(`/api/leaderboard/match?matchId=${selectedMatchId}`)
      .then(r => r.json())
      .then(data => { setMatchPlayers(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab, selectedMatchId])

  const selectedMatch = matches.find(m => m.id === selectedMatchId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
        <p className="text-gray-400 text-sm mt-1">Rankings across all matches</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit">
        <button
          onClick={() => setTab('overall')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'overall'
              ? 'bg-green-600 text-white shadow'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          🏆 Overall
        </button>
        <button
          onClick={() => setTab('match')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'match'
              ? 'bg-green-600 text-white shadow'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          🏏 By Match
        </button>
      </div>

      {/* ── OVERALL TAB ── */}
      {tab === 'overall' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h2 className="font-semibold text-white">Overall Rankings</h2>
            <p className="text-xs text-gray-500 mt-0.5">Ranked by total winnings across all matches</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Rank</th>
                <th className="text-left px-5 py-3">Player</th>
                <th className="text-right px-5 py-3">Winnings</th>
                <th className="text-right px-5 py-3">W / L</th>
                <th className="text-right px-5 py-3">Balance</th>
              </tr>
            </thead>
            <tbody>
              {overall.map((p, idx) => (
                <tr key={p.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${idx < 3 ? 'bg-gray-800/20' : ''}`}>
                  <td className="px-5 py-3.5">
                    <span className={`font-bold text-base ${rankColor(idx)}`}>{rankMedal(idx)}</span>
                  </td>
                  <td className="px-5 py-3.5 font-medium text-white">{p.display_name}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-green-400">
                    ₹{Number(p.total_winnings).toLocaleString('en-IN')}
                  </td>
                  <td className="px-5 py-3.5 text-right text-gray-400">
                    <span className="text-green-400">{p.bets_won}</span>
                    <span className="text-gray-600"> / </span>
                    <span className="text-red-400">{Number(p.total_bets) - Number(p.bets_won)}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-gray-300">
                    ₹{Number(p.wallet_balance).toLocaleString('en-IN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {overall.length === 0 && (
            <p className="text-center text-gray-500 py-12">No bets placed yet.</p>
          )}
        </div>
      )}

      {/* ── MATCH TAB ── */}
      {tab === 'match' && (
        <div className="space-y-4">
          {/* Match selector */}
          <select
            value={selectedMatchId}
            onChange={e => setSelectedMatchId(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
          >
            {matches.map(m => (
              <option key={m.id} value={m.id}>
                {m.team_a} vs {m.team_b} — {format(new Date(m.match_date), 'dd MMM yyyy')}
                {m.status === 'live' ? ' 🔴 LIVE' : m.status === 'completed' ? ' ✅' : ''}
              </option>
            ))}
          </select>

          {/* Match leaderboard table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">
                {selectedMatch ? `${selectedMatch.team_a} vs ${selectedMatch.team_b}` : 'Match'} — Rankings
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">Ranked by net P&amp;L (winnings minus staked)</p>
            </div>

            {loading ? (
              <div className="text-center text-gray-500 py-12">
                <div className="animate-pulse">Loading...</div>
              </div>
            ) : matchPlayers.length === 0 ? (
              <p className="text-center text-gray-500 py-12">No bets placed for this match yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-5 py-3">Rank</th>
                    <th className="text-left px-5 py-3">Player</th>
                    <th className="text-right px-5 py-3">Staked</th>
                    <th className="text-right px-5 py-3">Winnings</th>
                    <th className="text-right px-5 py-3">Net P&amp;L</th>
                    <th className="text-right px-5 py-3">W / L</th>
                  </tr>
                </thead>
                <tbody>
                  {matchPlayers.map((p, idx) => (
                    <tr key={p.display_name} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${idx < 3 ? 'bg-gray-800/20' : ''}`}>
                      <td className="px-5 py-3.5">
                        <span className={`font-bold text-base ${rankColor(idx)}`}>{rankMedal(idx)}</span>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-white">{p.display_name}</td>
                      <td className="px-5 py-3.5 text-right text-gray-400">
                        ₹{Number(p.total_staked).toLocaleString('en-IN')}
                      </td>
                      <td className="px-5 py-3.5 text-right text-green-400">
                        ₹{Number(p.total_winnings).toLocaleString('en-IN')}
                      </td>
                      <td className={`px-5 py-3.5 text-right font-semibold ${p.net_pl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {p.net_pl >= 0 ? '+' : ''}₹{Number(p.net_pl).toLocaleString('en-IN')}
                      </td>
                      <td className="px-5 py-3.5 text-right text-gray-400">
                        <span className="text-green-400">{p.bets_won}</span>
                        <span className="text-gray-600"> / </span>
                        <span className="text-red-400">{p.total_bets - p.bets_won}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
