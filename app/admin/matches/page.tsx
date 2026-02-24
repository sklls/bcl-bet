'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'

type Bet = { id: string; user_id: string; amount: number; status: string; placed_at: string; profiles?: { display_name: string } }
type BetOption = { id: string; label: string; total_amount_bet: number; bets?: Bet[] }
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

  // Cache of team players: { [teamName]: playerName[] }
  const [teamPlayers, setTeamPlayers] = useState<Record<string, string[]>>({})
  // For top_scorer: track which players are checked
  const [checkedPlayers, setCheckedPlayers] = useState<Record<string, boolean>>({})

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

  // Fetch players for both teams and cache them
  async function fetchTeamPlayers(teamA: string, teamB: string) {
    const needed = [teamA, teamB].filter(t => !teamPlayers[t])
    if (needed.length === 0) return teamPlayers
    const res = await fetch(`/api/admin/players?teams=${needed.join(',')}`)
    if (!res.ok) return teamPlayers
    const data: Record<string, string[]> = await res.json()
    const updated = { ...teamPlayers, ...data }
    setTeamPlayers(updated)
    return updated
  }

  // Open market form for a match — prefetch players
  async function openMarketForm(match: Match) {
    const isOpen = showCreateMarket === match.id
    if (isOpen) { setShowCreateMarket(null); return }
    setShowCreateMarket(match.id)
    const players = await fetchTeamPlayers(match.team_a, match.team_b)
    // Default to winner type — prefill team names
    const defaultOptions = `${match.team_a}\n${match.team_b}`
    setMkForm({ market_type: 'winner', options: defaultOptions, house_edge_pct: '5' })
    // Init all players checked
    const allPlayers = [...(players[match.team_a] ?? []), ...(players[match.team_b] ?? [])]
    const checked: Record<string, boolean> = {}
    allPlayers.forEach(p => { checked[p] = true })
    setCheckedPlayers(checked)
  }

  // When market type changes, auto-fill options
  function handleMarketTypeChange(type: string, match: Match) {
    setMkForm(f => ({ ...f, market_type: type }))
    const playersA = teamPlayers[match.team_a] ?? []
    const playersB = teamPlayers[match.team_b] ?? []
    if (type === 'winner') {
      setMkForm(f => ({ ...f, market_type: type, options: `${match.team_a}\n${match.team_b}` }))
    } else if (type === 'top_scorer') {
      // Reset all checked
      const allPlayers = [...playersA, ...playersB]
      const checked: Record<string, boolean> = {}
      allPlayers.forEach(p => { checked[p] = true })
      setCheckedPlayers(checked)
      setMkForm(f => ({ ...f, market_type: type, options: allPlayers.join('\n') }))
    } else {
      setMkForm(f => ({ ...f, market_type: type, options: '' }))
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

  async function deleteMatch(matchId: string, matchName: string) {
    if (!confirm(`Delete "${matchName}"? All pending bets will be refunded and the match removed permanently.`)) return
    const res = await fetch(`/api/admin/matches?id=${matchId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) {
      setMsg(`Match deleted. ${d.refunded} bet(s) refunded.`)
      loadMatches()
    } else {
      setMsg(d.error ?? 'Error deleting match')
    }
  }

  async function deleteMarket(marketId: string, marketType: string) {
    if (!confirm(`Delete this ${marketType} market? All pending bets will be refunded.`)) return
    const res = await fetch(`/api/admin/markets?id=${marketId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) {
      setMsg(`Market deleted. ${d.refunded} bet(s) refunded.`)
      loadMatches()
    } else {
      setMsg(d.error ?? 'Error deleting market')
    }
  }

  async function voidBet(betId: string, amount: number) {
    if (!confirm(`Void this ₹${amount} bet and refund the user?`)) return
    const res = await fetch(`/api/admin/bets?id=${betId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) {
      setMsg(`Bet voided. ₹${d.refunded} refunded.`)
      loadMatches()
    } else {
      setMsg(d.error ?? 'Error voiding bet')
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
                  onClick={() => openMarketForm(match)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs"
                >
                  + Market
                </button>
                <button
                  onClick={() => deleteMatch(match.id, `${match.team_a} vs ${match.team_b}`)}
                  className="px-3 py-1 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded text-xs font-medium"
                >
                  🗑 Delete
                </button>
              </div>
            </div>

            {/* Create Market Form */}
            {showCreateMarket === match.id && (
              <form onSubmit={(e) => createMarket(match.id, e)} className="bg-gray-800 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">New Market</h3>

                {/* Market type selector */}
                <select
                  value={mkForm.market_type}
                  onChange={(e) => handleMarketTypeChange(e.target.value, match)}
                  className="w-full px-3 py-2 bg-gray-700 rounded text-white text-sm"
                >
                  {MARKET_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {/* Top Scorer: checkbox player list grouped by team */}
                {mkForm.market_type === 'top_scorer' ? (
                  <div className="space-y-2">
                    {[match.team_a, match.team_b].map(teamName => {
                      const players = teamPlayers[teamName] ?? []
                      return (
                        <div key={teamName}>
                          <p className="text-xs font-semibold text-green-400 mb-1">{teamName}</p>
                          <div className="grid grid-cols-2 gap-1">
                            {players.length === 0 && (
                              <p className="text-xs text-gray-500 col-span-2">Loading players...</p>
                            )}
                            {players.map(player => (
                              <label key={player} className="flex items-center gap-2 cursor-pointer px-2 py-1 bg-gray-700 rounded hover:bg-gray-600">
                                <input
                                  type="checkbox"
                                  checked={checkedPlayers[player] ?? true}
                                  onChange={(e) => {
                                    const updated = { ...checkedPlayers, [player]: e.target.checked }
                                    setCheckedPlayers(updated)
                                    // Sync options text from checked state
                                    const allPlayers = [
                                      ...(teamPlayers[match.team_a] ?? []),
                                      ...(teamPlayers[match.team_b] ?? []),
                                    ]
                                    const selected = allPlayers.filter(p => updated[p] ?? true)
                                    setMkForm(f => ({ ...f, options: selected.join('\n') }))
                                  }}
                                  className="accent-green-500"
                                />
                                <span className="text-xs text-white">{player}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    <p className="text-xs text-gray-400">
                      {mkForm.options.split('\n').filter(Boolean).length} players selected
                    </p>
                  </div>
                ) : mkForm.market_type === 'winner' ? (
                  /* Winner: show two team buttons, not editable */
                  <div className="flex gap-2">
                    {[match.team_a, match.team_b].map(t => (
                      <div key={t} className="flex-1 px-3 py-2 bg-gray-700 rounded text-white text-sm text-center font-medium">{t}</div>
                    ))}
                  </div>
                ) : (
                  /* Over/Under, Live: free-text textarea */
                  <textarea
                    required
                    placeholder={`Bet options (one per line)\ne.g.\nOver 142.5\nUnder 142.5`}
                    value={mkForm.options}
                    onChange={(e) => setMkForm({ ...mkForm, options: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 bg-gray-700 rounded text-white text-sm font-mono"
                  />
                )}

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
                        {market.status !== 'settled' && (
                          <button
                            onClick={() => deleteMarket(market.id, market.market_type.replace('_', ' '))}
                            className="px-2 py-1 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded text-xs"
                          >
                            🗑 Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bet options with settle + individual bets */}
                    <div className="space-y-2">
                      {market.bet_options?.map((opt) => (
                        <div key={opt.id} className="bg-gray-700 rounded p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="text-xs font-medium text-white">{opt.label}</p>
                              <p className="text-xs text-gray-400">₹{Number(opt.total_amount_bet).toLocaleString()} total</p>
                            </div>
                            {market.status === 'closed' && (
                              <button
                                onClick={() => {
                                  if (confirm(`Declare "${opt.label}" as winner? This will pay out all winning bets.`)) {
                                    settleMarket(market.id, opt.id)
                                  }
                                }}
                                className="text-xs px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded"
                              >
                                ✓ Winner
                              </button>
                            )}
                          </div>
                          {/* Individual bets */}
                          {opt.bets && opt.bets.filter(b => b.status !== 'void').length > 0 && (
                            <div className="space-y-1 mt-1 border-t border-gray-600 pt-1">
                              {opt.bets.filter(b => b.status !== 'void').map((bet) => (
                                <div key={bet.id} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-300">
                                    {bet.profiles?.display_name ?? bet.user_id.slice(0, 8)} — ₹{Number(bet.amount).toLocaleString()}
                                    <span className={`ml-1 ${bet.status === 'won' ? 'text-green-400' : bet.status === 'lost' ? 'text-red-400' : 'text-yellow-400'}`}>
                                      ({bet.status})
                                    </span>
                                  </span>
                                  {bet.status === 'pending' && (
                                    <button
                                      onClick={() => voidBet(bet.id, Number(bet.amount))}
                                      className="px-1.5 py-0.5 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded text-xs ml-2"
                                    >
                                      Void
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
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
