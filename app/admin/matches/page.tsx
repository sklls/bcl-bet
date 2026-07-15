'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { SPORTS, ALL_SPORTS, SPORT_MARKETS, PLAYER_PICKER_MARKETS, SportType } from '@/lib/sports'

type Bet = { id: string; user_id: string; amount: number; status: string; placed_at: string; profiles?: { display_name: string } }
type BetOption = { id: string; label: string; total_amount_bet: number; bets?: Bet[] }
type Market = { id: string; market_type: string; title: string | null; status: string; result: string | null; bet_options: BetOption[] }
type Match = {
  id: string
  team_a: string
  team_b: string
  match_date: string
  venue: string | null
  status: string
  sport: SportType
  markets: Market[]
}
type Team = { id: string; name: string }

export default function AdminMatchesPage() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateMatch, setShowCreateMatch] = useState(false)
  const [showCreateMarket, setShowCreateMarket] = useState<string | null>(null)
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set())
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editingTitleValue, setEditingTitleValue] = useState('')
  const [msg, setMsg] = useState('')

  const [sportTeams, setSportTeams] = useState<Team[]>([])
  const [teamPlayers, setTeamPlayers] = useState<Record<string, string[]>>({})
  const [checkedPlayers, setCheckedPlayers] = useState<Record<string, boolean>>({})
  const [customCheckedPlayers, setCustomCheckedPlayers] = useState<Record<string, boolean>>({})
  const [customExtraOptions, setCustomExtraOptions] = useState('')

  const [mForm, setMForm] = useState({
    sport: 'cricket' as SportType,
    team_a: '',
    team_b: '',
    match_date: '',
    venue: '',
  })

  const [mkForm, setMkForm] = useState({
    market_type: 'winner',
    options: '',
    house_edge_pct: '5',
    customTitle: '',
  })

  const loadMatches = useCallback(async () => {
    const res = await fetch('/api/admin/matches')
    if (res.ok) setMatches(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { loadMatches() }, [loadMatches])

  async function fetchSportTeams(sport: SportType) {
    const res = await fetch(`/api/admin/teams?sport=${sport}`)
    if (res.ok) setSportTeams(await res.json())
    else setSportTeams([])
  }

  async function fetchTeamPlayers(teamA: string, teamB: string) {
    const needed = [teamA, teamB].filter(t => t && !teamPlayers[t])
    if (needed.length === 0) return teamPlayers
    const res = await fetch(`/api/admin/players?teams=${needed.join(',')}`)
    if (!res.ok) return teamPlayers
    const data: Record<string, string[]> = await res.json()
    const updated = { ...teamPlayers, ...data }
    setTeamPlayers(updated)
    return updated
  }

  function toggleMarketExpand(marketId: string) {
    setExpandedMarkets(prev => {
      const next = new Set(prev)
      next.has(marketId) ? next.delete(marketId) : next.add(marketId)
      return next
    })
  }

  async function saveMarketTitle(marketId: string) {
    const title = editingTitleValue.trim()
    if (!title) return
    const res = await fetch('/api/admin/markets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, title }),
    })
    if (res.ok) { setMsg('Title updated!'); setEditingTitleId(null); loadMatches() }
    else { const d = await res.json(); setMsg(d.error ?? 'Error') }
  }

  async function createMatch(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const res = await fetch('/api/admin/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mForm),
    })
    if (res.ok) {
      setMsg('Match created!')
      setShowCreateMatch(false)
      setMForm({ sport: 'cricket', team_a: '', team_b: '', match_date: '', venue: '' })
      setSportTeams([])
      loadMatches()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error creating match')
    }
  }

  async function openMarketForm(match: Match) {
    if (showCreateMarket === match.id) { setShowCreateMarket(null); return }
    setShowCreateMarket(match.id)
    const players = await fetchTeamPlayers(match.team_a, match.team_b)
    setMkForm({ market_type: 'winner', options: `${match.team_a}\n${match.team_b}`, house_edge_pct: '5', customTitle: '' })
    setCustomExtraOptions('')
    const allPlayers = [...(players[match.team_a] ?? []), ...(players[match.team_b] ?? [])]
    const checked: Record<string, boolean> = {}
    allPlayers.forEach(p => { checked[p] = true })
    setCheckedPlayers(checked)
    const unchecked: Record<string, boolean> = {}
    allPlayers.forEach(p => { unchecked[p] = false })
    setCustomCheckedPlayers(unchecked)
  }

  function handleMarketTypeChange(type: string, match: Match) {
    setMkForm(f => ({ ...f, market_type: type }))
    const playersA = teamPlayers[match.team_a] ?? []
    const playersB = teamPlayers[match.team_b] ?? []
    const allPlayers = [...playersA, ...playersB]

    if (type === 'winner') {
      setMkForm(f => ({ ...f, market_type: type, options: `${match.team_a}\n${match.team_b}` }))
    } else if (PLAYER_PICKER_MARKETS.has(type)) {
      const checked: Record<string, boolean> = {}
      allPlayers.forEach(p => { checked[p] = true })
      setCheckedPlayers(checked)
      setMkForm(f => ({ ...f, market_type: type, options: allPlayers.join('\n') }))
    } else if (type === 'custom') {
      const unchecked: Record<string, boolean> = {}
      allPlayers.forEach(p => { unchecked[p] = false })
      setCustomCheckedPlayers(unchecked)
      setCustomExtraOptions('')
      setMkForm(f => ({ ...f, market_type: type, options: '', customTitle: '' }))
    } else {
      setMkForm(f => ({ ...f, market_type: type, options: '', customTitle: '' }))
    }
  }

  async function createMarket(matchId: string, e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const options = mkForm.market_type === 'custom'
      ? [
          ...Object.entries(customCheckedPlayers).filter(([, v]) => v).map(([k]) => k),
          ...customExtraOptions.split('\n').map(s => s.trim()).filter(Boolean),
        ]
      : mkForm.options.split('\n').map(s => s.trim()).filter(Boolean)

    const res = await fetch('/api/admin/markets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_id: matchId,
        market_type: mkForm.market_type,
        title: mkForm.market_type === 'custom' ? mkForm.customTitle.trim() : undefined,
        options,
        house_edge_pct: parseFloat(mkForm.house_edge_pct),
      }),
    })
    if (res.ok) { setMsg('Market created!'); setShowCreateMarket(null); loadMatches() }
    else { const d = await res.json(); setMsg(d.error ?? 'Error creating market') }
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
    if (res.ok) { setMsg('Market settled! Payouts credited.'); loadMatches() }
    else { const d = await res.json(); setMsg(d.error ?? 'Error settling market') }
  }

  async function deleteMatch(matchId: string, matchName: string) {
    if (!confirm(`Delete "${matchName}"? All pending bets will be refunded.`)) return
    const res = await fetch(`/api/admin/matches?id=${matchId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) { setMsg(`Match deleted. ${d.refunded} bet(s) refunded.`); loadMatches() }
    else setMsg(d.error ?? 'Error deleting match')
  }

  async function deleteMarket(marketId: string, marketType: string) {
    if (!confirm(`Delete this ${marketType} market? All pending bets will be refunded.`)) return
    const res = await fetch(`/api/admin/markets?id=${marketId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) { setMsg(`Market deleted. ${d.refunded} bet(s) refunded.`); loadMatches() }
    else setMsg(d.error ?? 'Error deleting market')
  }

  async function voidBet(betId: string, amount: number) {
    if (!confirm(`Void this ₹${amount} bet and refund the user?`)) return
    const res = await fetch(`/api/admin/bets?id=${betId}`, { method: 'DELETE' })
    const d = await res.json()
    if (res.ok) { setMsg(`Bet voided. ₹${d.refunded} refunded.`); loadMatches() }
    else setMsg(d.error ?? 'Error voiding bet')
  }

  if (loading) return <div className="text-slate py-10 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Matches &amp; Markets</h1>
        <button
          onClick={() => setShowCreateMatch(!showCreateMatch)}
          className="px-4 py-2 bg-amber hover:bg-amber-deep text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Match
        </button>
      </div>

      {msg && <div className="bg-raised border border-rail rounded-lg px-4 py-2 text-sm text-slate">{msg}</div>}

      {/* Create Match Form */}
      {showCreateMatch && (
        <form onSubmit={createMatch} className="bg-table border border-rail rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-white">New Match</h2>

          <select
            value={mForm.sport}
            onChange={e => {
              const sport = e.target.value as SportType
              setMForm({ ...mForm, sport, team_a: '', team_b: '' })
              fetchSportTeams(sport)
            }}
            className="w-full px-3 py-2 bg-raised border border-rail rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber"
          >
            {ALL_SPORTS.map(s => (
              <option key={s} value={s}>{SPORTS[s].emoji} {SPORTS[s].label}</option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-3">
            <select
              required
              value={mForm.team_a}
              onChange={e => setMForm({ ...mForm, team_a: e.target.value })}
              className="px-3 py-2 bg-raised border border-rail rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber"
            >
              <option value="">Team A</option>
              {sportTeams.filter(t => t.name !== mForm.team_b).map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
            <select
              required
              value={mForm.team_b}
              onChange={e => setMForm({ ...mForm, team_b: e.target.value })}
              className="px-3 py-2 bg-raised border border-rail rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber"
            >
              <option value="">Team B</option>
              {sportTeams.filter(t => t.name !== mForm.team_a).map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {sportTeams.length === 0 && (
            <p className="text-xs text-crimson-light">
              No {SPORTS[mForm.sport].label} teams registered yet.{' '}
              <a href="/admin/teams" className="underline text-amber">Add teams first →</a>
            </p>
          )}

          <input
            required
            type="datetime-local"
            value={mForm.match_date}
            onChange={e => setMForm({ ...mForm, match_date: e.target.value })}
            className="w-full px-3 py-2 bg-raised border border-rail rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber"
          />
          <input
            placeholder="Venue (optional)"
            value={mForm.venue}
            onChange={e => setMForm({ ...mForm, venue: e.target.value })}
            className="w-full px-3 py-2 bg-raised border border-rail rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber"
          />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber hover:bg-amber-deep text-white rounded-lg text-sm font-medium">Create</button>
            <button type="button" onClick={() => setShowCreateMatch(false)} className="px-4 py-2 bg-raised text-slate rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Matches List */}
      <div className="space-y-4">
        {matches.map((match) => {
          const sportMarkets = SPORT_MARKETS[match.sport] ?? SPORT_MARKETS.cricket
          return (
            <div key={match.id} className="bg-table border border-rail rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate mb-0.5">{SPORTS[match.sport]?.emoji} {SPORTS[match.sport]?.label}</p>
                  <h2 className="font-bold text-white">{match.team_a} vs {match.team_b}</h2>
                  <p className="text-xs text-slate">
                    {format(new Date(match.match_date), 'dd MMM yyyy, h:mm a')} · {match.venue ?? 'TBD'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    match.status === 'live'      ? 'bg-crimson text-white' :
                    match.status === 'upcoming'  ? 'bg-royal text-white' :
                                                   'bg-rail text-slate'
                  }`}>{match.status}</span>
                  <button onClick={() => openMarketForm(match)} className="px-3 py-1 bg-raised hover:bg-rail text-slate rounded text-xs">
                    + Market
                  </button>
                  <button onClick={() => deleteMatch(match.id, `${match.team_a} vs ${match.team_b}`)} className="px-3 py-1 bg-crimson/10 hover:bg-crimson/20 text-crimson-light rounded text-xs">
                    🗑 Delete
                  </button>
                </div>
              </div>

              {/* Create Market Form */}
              {showCreateMarket === match.id && (
                <form onSubmit={(e) => createMarket(match.id, e)} className="bg-baize border border-rail rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-white">New Market</h3>

                  <select
                    value={mkForm.market_type}
                    onChange={e => handleMarketTypeChange(e.target.value, match)}
                    className="w-full px-3 py-2 bg-raised border border-rail rounded text-white text-sm"
                  >
                    {sportMarkets.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>

                  {PLAYER_PICKER_MARKETS.has(mkForm.market_type) ? (
                    <div className="space-y-2">
                      {[match.team_a, match.team_b].map(teamName => {
                        const players = teamPlayers[teamName] ?? []
                        return (
                          <div key={teamName}>
                            <p className="text-xs font-semibold text-amber mb-1">{teamName}</p>
                            <div className="grid grid-cols-2 gap-1">
                              {players.length === 0 && <p className="text-xs text-slate col-span-2">No players registered</p>}
                              {players.map(player => (
                                <label key={player} className="flex items-center gap-2 cursor-pointer px-2 py-1 bg-raised rounded hover:bg-rail">
                                  <input
                                    type="checkbox"
                                    checked={checkedPlayers[player] ?? true}
                                    onChange={e => {
                                      const updated = { ...checkedPlayers, [player]: e.target.checked }
                                      setCheckedPlayers(updated)
                                      const allPlayers = [
                                        ...(teamPlayers[match.team_a] ?? []),
                                        ...(teamPlayers[match.team_b] ?? []),
                                      ]
                                      setMkForm(f => ({ ...f, options: allPlayers.filter(p => updated[p] ?? true).join('\n') }))
                                    }}
                                    className="accent-amber"
                                  />
                                  <span className="text-xs text-white">{player}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : mkForm.market_type === 'winner' ? (
                    <div className="flex gap-2">
                      {[match.team_a, match.team_b].map(t => (
                        <div key={t} className="flex-1 px-3 py-2 bg-raised border border-rail rounded text-white text-sm text-center font-medium">{t}</div>
                      ))}
                    </div>
                  ) : mkForm.market_type === 'custom' ? (
                    <div className="space-y-3">
                      <input
                        required
                        placeholder="Market title (e.g. Top Points Scorer)"
                        value={mkForm.customTitle}
                        onChange={e => setMkForm({ ...mkForm, customTitle: e.target.value })}
                        className="w-full px-3 py-2 bg-raised border border-rail rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber"
                      />
                      {[match.team_a, match.team_b].map(teamName => {
                        const players = teamPlayers[teamName] ?? []
                        return (
                          <div key={teamName}>
                            <p className="text-xs font-semibold text-amber mb-1">{teamName}</p>
                            <div className="grid grid-cols-2 gap-1">
                              {players.map(player => (
                                <label key={player} className="flex items-center gap-2 cursor-pointer px-2 py-1 bg-raised rounded hover:bg-rail">
                                  <input
                                    type="checkbox"
                                    checked={customCheckedPlayers[player] ?? false}
                                    onChange={e => setCustomCheckedPlayers(prev => ({ ...prev, [player]: e.target.checked }))}
                                    className="accent-amber"
                                  />
                                  <span className="text-xs text-white">{player}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                      <textarea
                        placeholder="Additional options (one per line)"
                        value={customExtraOptions}
                        onChange={e => setCustomExtraOptions(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 bg-raised border border-rail rounded text-white text-sm font-mono"
                      />
                    </div>
                  ) : (
                    <textarea
                      required
                      placeholder={`Bet options (one per line)\ne.g.\nOver 5.5\nUnder 5.5`}
                      value={mkForm.options}
                      onChange={e => setMkForm({ ...mkForm, options: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 bg-raised border border-rail rounded text-white text-sm font-mono"
                    />
                  )}

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate">House edge %</label>
                    <input
                      type="number" value={mkForm.house_edge_pct} min="0" max="20"
                      onChange={e => setMkForm({ ...mkForm, house_edge_pct: e.target.value })}
                      className="w-20 px-2 py-1 bg-raised border border-rail rounded text-white text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="px-3 py-1.5 bg-amber hover:bg-amber-deep text-white rounded text-sm">Create</button>
                    <button type="button" onClick={() => setShowCreateMarket(null)} className="px-3 py-1.5 bg-raised text-slate rounded text-sm">Cancel</button>
                  </div>
                </form>
              )}

              {/* Markets */}
              {match.markets?.length > 0 && (
                <div className="space-y-3">
                  {match.markets.map(market => (
                    <div key={market.id} className="bg-baize border border-rail rounded-lg p-4">
                      <div
                        className="flex items-center justify-between cursor-pointer select-none"
                        onClick={() => toggleMarketExpand(market.id)}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-slate text-xs">{expandedMarkets.has(market.id) ? '▾' : '▸'}</span>
                          {editingTitleId === market.id ? (
                            <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                              <input
                                autoFocus
                                value={editingTitleValue}
                                onChange={e => setEditingTitleValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveMarketTitle(market.id); if (e.key === 'Escape') setEditingTitleId(null) }}
                                className="flex-1 px-2 py-0.5 bg-raised border border-rail rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber"
                              />
                              <button onClick={() => saveMarketTitle(market.id)} className="text-xs px-2 py-0.5 bg-amber hover:bg-amber-deep text-white rounded">Save</button>
                              <button onClick={() => setEditingTitleId(null)} className="text-xs px-2 py-0.5 bg-raised text-slate rounded">✕</button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-medium text-white capitalize">
                                {market.title || market.market_type.replace(/_/g, ' ')}
                              </span>
                              <button
                                onClick={e => { e.stopPropagation(); setEditingTitleId(market.id); setEditingTitleValue(market.title || '') }}
                                className="text-slate hover:text-slate text-xs"
                              >✎</button>
                              <span className="text-xs text-slate">
                                {market.bet_options?.length ?? 0} options · ₹{(market.bet_options ?? []).reduce((s, o) => s + Number(o.total_amount_bet), 0).toLocaleString('en-IN')} staked
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          {market.status !== 'settled' && (
                            <button
                              onClick={() => toggleMarket(market.id, market.status)}
                              className={`px-3 py-1 rounded text-xs font-medium ${
                                market.status === 'open'
                                  ? 'bg-gold/20 text-gold hover:bg-gold/30'
                                  : 'bg-amber/20 text-amber hover:bg-amber/30'
                              }`}
                            >
                              {market.status === 'open' ? 'Close Betting' : 'Open Betting'}
                            </button>
                          )}
                          {market.status === 'settled' && (
                            <span className="text-xs text-slate">Settled: {market.result}</span>
                          )}
                          {market.status !== 'settled' && (
                            <button
                              onClick={() => deleteMarket(market.id, market.market_type.replace(/_/g, ' '))}
                              className="px-2 py-1 bg-crimson/10 hover:bg-crimson/20 text-crimson-light rounded text-xs"
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </div>

                      {expandedMarkets.has(market.id) && (
                        <div className="space-y-2 mt-3">
                          {market.bet_options?.map(opt => (
                            <div key={opt.id} className="bg-table border border-rail rounded p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div>
                                  <p className="text-xs font-medium text-white">{opt.label}</p>
                                  <p className="text-xs text-slate">₹{Number(opt.total_amount_bet).toLocaleString()} total</p>
                                </div>
                                {(market.status === 'closed' || market.status === 'open') && (
                                  <button
                                    onClick={() => { if (confirm(`Declare "${opt.label}" as winner?`)) settleMarket(market.id, opt.id) }}
                                    className="text-xs px-2 py-1 bg-amber hover:bg-amber-deep text-white rounded"
                                  >
                                    ✓ Winner
                                  </button>
                                )}
                              </div>
                              {opt.bets && opt.bets.filter(b => b.status !== 'void').length > 0 && (
                                <div className="space-y-1 mt-1 border-t border-rail pt-1">
                                  {opt.bets.filter(b => b.status !== 'void').map(bet => (
                                    <div key={bet.id} className="flex items-center justify-between text-xs">
                                      <span className="text-slate">
                                        {bet.profiles?.display_name ?? bet.user_id.slice(0, 8)} — ₹{Number(bet.amount).toLocaleString()}
                                        <span className={`ml-1 ${bet.status === 'won' ? 'text-amber' : bet.status === 'lost' ? 'text-crimson-light' : 'text-gold'}`}>
                                          ({bet.status})
                                        </span>
                                      </span>
                                      {bet.status === 'pending' && (
                                        <button
                                          onClick={() => voidBet(bet.id, Number(bet.amount))}
                                          className="px-1.5 py-0.5 bg-crimson/10 hover:bg-crimson/20 text-crimson-light rounded ml-2"
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
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {matches.length === 0 && (
          <p className="text-slate text-center py-10">No matches yet. Create one above.</p>
        )}
      </div>
    </div>
  )
}
