'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'

type BetOption = { id: string; label: string; total_amount_bet: number }
type Market = { id: string; market_type: string; status: string; result: string | null; bet_options: BetOption[] }
type Match = {
  id: string
  team_a: string
  team_b: string
  match_date: string
  venue: string | null
  status: string
  cricheroes_match_id: string | null
  markets: Market[]
}

const MARKET_TYPE_OPTIONS = [
  { value: 'winner', label: 'Match Winner' },
  { value: 'top_scorer', label: 'Top Scorer' },
  { value: 'over_under', label: 'Over / Under' },
  { value: 'live', label: 'Live Market' },
]

export default function AdminMatchesPage() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateMatch, setShowCreateMatch] = useState(false)
  const [showCreateMarket, setShowCreateMarket] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  // Create match form state
  const [mForm, setMForm] = useState({
    team_a: '', team_b: '', match_date: '', venue: '', over_under_line: '', cricheroes_url: '',
  })

  // Create market form state
  const [mkForm, setMkForm] = useState({
    market_type: 'winner', options: '', house_edge_pct: '5',
  })

  async function loadMatches() {
    const res = await fetch('/api/admin/matches')
    if (res.ok) setMatches(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadMatches() }, [])

  async function createMatch(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const body = {
      ...mForm,
      over_under_line: mForm.over_under_line ? parseFloat(mForm.over_under_line) : undefined,
      cricheroes_url: mForm.cricheroes_url || undefined,
    }
    const res = await fetch('/api/admin/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setMsg('Match created!')
      setShowCreateMatch(false)
      setMForm({ team_a: '', team_b: '', match_date: '', venue: '', over_under_line: '', cricheroes_url: '' })
      loadMatches()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error creating match')
    }
  }

  async function createMarket(matchId: string, e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const options = mkForm.options.split('\n').map((s) => s.trim()).filter(Boolean)
    const res = await fetch('/api/admin/markets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_id: matchId,
        market_type: mkForm.market_type,
        options,
        house_edge_pct: parseFloat(mkForm.house_edge_pct),
      }),
    })
    if (res.ok) {
      setMsg('Market created!')
      setShowCreateMarket(null)
      loadMatches()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error creating market')
    }
  }

  async function toggleMarket(marketId: string, currentStatus: string) {
    const newStatus = currentStatus === 'open' ? 'closed' : 'open'
    await fetch('/api/admin/markets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, status: newStatus }),
    })
    loadMatches()
  }

  async function settleMarket(marketId: string, winningOptionId: string) {
    const res = await fetch('/api/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, winning_option_id: winningOptionId }),
    })
    if (res.ok) {
      setMsg('Market settled! Payouts credited.')
      loadMatches()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error settling market')
    }
  }

  async function updateMatchStatus(matchId: string, status: string) {
    // Use admin client via a simple PATCH - add this route if needed
    // For now we'll directly patch via supabase (admin panel can do this inline)
    setMsg(`Status update for match ${matchId} to ${status} — use Supabase dashboard or add a PATCH /api/admin/matches/[id] route.`)
  }

  if (loading) return <div className="text-gray-400 py-10 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Matches & Markets</h1>
        <button
          onClick={() => setShowCreateMatch(!showCreateMatch)}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Match
        </button>
      </div>

      {msg && (
        <div className="bg-gray-800 rounded-lg px-4 py-2 text-sm text-yellow-300">{msg}</div>
      )}

      {/* Create Match Form */}
      {showCreateMatch && (
        <form onSubmit={createMatch} className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-white">New Match</h2>
          <div className="grid grid-cols-2 gap-3">
            <input required placeholder="Team A" value={mForm.team_a} onChange={(e) => setMForm({ ...mForm, team_a: e.target.value })}
              className="px-3 py-2 bg-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <input required placeholder="Team B" value={mForm.team_b} onChange={(e) => setMForm({ ...mForm, team_b: e.target.value })}
              className="px-3 py-2 bg-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <input required type="datetime-local" value={mForm.match_date} onChange={(e) => setMForm({ ...mForm, match_date: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <input placeholder="Venue" value={mForm.venue} onChange={(e) => setMForm({ ...mForm, venue: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <input placeholder="Over/Under line (e.g. 142.5)" type="number" value={mForm.over_under_line} onChange={(e) => setMForm({ ...mForm, over_under_line: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <input placeholder="CricHeroes scorecard URL (optional)" value={mForm.cricheroes_url} onChange={(e) => setMForm({ ...mForm, cricheroes_url: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium">Create</button>
            <button type="button" onClick={() => setShowCreateMatch(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Matches List */}
      <div className="space-y-4">
        {matches.map((match) => (
          <div key={match.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            {/* Match header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-white">{match.team_a} vs {match.team_b}</h2>
                <p className="text-xs text-gray-500">
                  {format(new Date(match.match_date), 'dd MMM yyyy, h:mm a')} · {match.venue ?? 'TBD'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  match.status === 'live' ? 'bg-red-500 text-white' :
                  match.status === 'upcoming' ? 'bg-blue-600 text-white' :
                  'bg-gray-600 text-gray-300'
                }`}>{match.status}</span>
                <button
                  onClick={() => setShowCreateMarket(showCreateMarket === match.id ? null : match.id)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs"
                >
                  + Market
                </button>
              </div>
            </div>

            {/* Create Market Form */}
            {showCreateMarket === match.id && (
              <form onSubmit={(e) => createMarket(match.id, e)} className="bg-gray-800 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">New Market</h3>
                <select value={mkForm.market_type} onChange={(e) => setMkForm({ ...mkForm, market_type: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 rounded text-white text-sm">
                  {MARKET_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <textarea
                  required
                  placeholder={`Bet options (one per line)\ne.g.\n${match.team_a}\n${match.team_b}`}
                  value={mkForm.options}
                  onChange={(e) => setMkForm({ ...mkForm, options: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-700 rounded text-white text-sm font-mono"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">House edge %</label>
                  <input type="number" value={mkForm.house_edge_pct} min="0" max="20"
                    onChange={(e) => setMkForm({ ...mkForm, house_edge_pct: e.target.value })}
                    className="w-20 px-2 py-1 bg-gray-700 rounded text-white text-sm" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-sm">Create</button>
                  <button type="button" onClick={() => setShowCreateMarket(null)} className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm">Cancel</button>
                </div>
              </form>
            )}

            {/* Markets */}
            {match.markets?.length > 0 && (
              <div className="space-y-3">
                {match.markets.map((market) => (
                  <div key={market.id} className="bg-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-white capitalize">
                        {market.market_type.replace('_', ' ')}
                      </span>
                      <div className="flex items-center gap-2">
                        {market.status !== 'settled' && (
                          <button
                            onClick={() => toggleMarket(market.id, market.status)}
                            className={`px-3 py-1 rounded text-xs font-medium ${
                              market.status === 'open'
                                ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                                : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                            }`}
                          >
                            {market.status === 'open' ? 'Close Betting' : 'Open Betting'}
                          </button>
                        )}
                        {market.status === 'settled' && (
                          <span className="text-xs text-gray-400">Settled: {market.result}</span>
                        )}
                      </div>
                    </div>

                    {/* Bet options with settle buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      {market.bet_options?.map((opt) => (
                        <div key={opt.id} className="flex items-center justify-between bg-gray-700 rounded px-3 py-2">
                          <div>
                            <p className="text-xs text-white">{opt.label}</p>
                            <p className="text-xs text-gray-400">₹{Number(opt.total_amount_bet).toLocaleString()} bet</p>
                          </div>
                          {market.status === 'closed' && (
                            <button
                              onClick={() => {
                                if (confirm(`Declare "${opt.label}" as winner? This will pay out all winning bets.`)) {
                                  settleMarket(market.id, opt.id)
                                }
                              }}
                              className="text-xs px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded ml-2"
                            >
                              Winner
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {matches.length === 0 && (
          <p className="text-gray-500 text-center py-10">No matches yet. Create one above.</p>
        )}
      </div>
    </div>
  )
}
