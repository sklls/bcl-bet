'use client'

import { useCallback, useEffect, useState } from 'react'
import { playerPoints, type PlayerStats, type FantasySport } from '@/lib/fantasy/scoring'

type Player = { id: string; name: string; role: string; credits: number; team_id: string }
type Team = { id: string; name: string }

type Row = PlayerStats & { player_id: string; played: boolean }

const CRICKET_FIELDS: { key: keyof Row; label: string; max: number }[] = [
  { key: 'runs',     label: 'Runs',     max: 500 },
  { key: 'wickets',  label: 'Wickets',  max: 20 },
  { key: 'catches',  label: 'Catches',  max: 20 },
  { key: 'sixes',    label: 'Sixes',    max: 50 },
  { key: 'run_outs', label: 'Run-outs', max: 20 },
]

const FOOTBALL_FIELDS: { key: keyof Row; label: string; max: number }[] = [
  { key: 'goals',   label: 'Goals',   max: 20 },
  { key: 'assists', label: 'Assists', max: 20 },
  { key: 'saves',   label: 'Saves',   max: 50 },
  { key: 'yellows', label: 'Yellow',  max: 2 },
  { key: 'reds',    label: 'Red',     max: 1 },
]

const blankRow = (playerId: string): Row => ({
  player_id: playerId, played: false,
  runs: 0, wickets: 0, catches: 0, sixes: 0, run_outs: 0,
  goals: 0, assists: 0, saves: 0, clean_sheet: false, yellows: 0, reds: 0,
})

function Stepper({
  label, value, max, onChange, wide,
}: {
  label: string; value: number; max: number; onChange: (v: number) => void; wide?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate w-16 shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-11 h-11 rounded bg-raised hover:bg-rail text-slate text-lg leading-none"
        >−</button>
        {wide ? (
          <input
            type="number"
            inputMode="numeric"
            value={value}
            min={0}
            max={max}
            onChange={e => {
              const n = parseInt(e.target.value, 10)
              onChange(Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0)
            }}
            className="w-16 h-11 text-center bg-baize border border-rail rounded text-white text-sm"
          />
        ) : (
          <span className="w-10 text-center text-sm font-semibold text-white">{value}</span>
        )}
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="w-11 h-11 rounded bg-raised hover:bg-rail text-slate text-lg leading-none"
        >+</button>
      </div>
    </div>
  )
}

export default function StatEntry({
  matchId, sport, homeTeam, onClose,
}: {
  matchId: string
  sport: FantasySport
  homeTeam: string
  onClose: () => void
}) {
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [squadRes, statsRes] = await Promise.all([
      fetch(`/api/fantasy/squad?matchId=${matchId}`),
      fetch(`/api/admin/fantasy/stats?matchId=${matchId}`),
    ])

    if (!squadRes.ok) {
      const d = await squadRes.json()
      setError(d.error ?? 'Could not load squads')
      setLoading(false)
      return
    }

    const squad = await squadRes.json()
    setTeams(squad.teams)
    setPlayers(squad.players)

    const saved: Record<string, Row> = {}
    for (const p of squad.players as Player[]) saved[p.id] = blankRow(p.id)
    if (statsRes.ok) {
      const { stats } = await statsRes.json()
      for (const s of stats as Row[]) saved[s.player_id] = { ...blankRow(s.player_id), ...s }
    }
    setRows(saved)
    setLoading(false)
  }, [matchId])

  useEffect(() => { load() }, [load])

  function update(playerId: string, patch: Partial<Row>) {
    setRows(prev => ({ ...prev, [playerId]: { ...prev[playerId], ...patch } }))
    setMsg('')
  }

  async function save() {
    setSaving(true)
    setError('')
    setMsg('')

    const res = await fetch('/api/admin/fantasy/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_id: matchId,
        stats: players.map(p => rows[p.id]).filter(Boolean),
      }),
    })
    const json = await res.json()
    setSaving(false)

    if (!res.ok) return setError(json.error ?? 'Could not save')
    setMsg(`Saved — points recalculated (${json.entries_scored} ${json.entries_scored === 1 ? 'entry' : 'entries'} rescored)`)
  }

  if (loading) return <p className="text-xs text-slate">Loading squads…</p>
  if (error && players.length === 0) return <p className="text-xs text-crimson-light">{error}</p>

  const fields = sport === 'cricket' ? CRICKET_FIELDS : FOOTBALL_FIELDS
  // Home team first — that is the order a scorer reads the teamsheet in.
  const ordered = [...teams].sort((a, b) => (a.name === homeTeam ? -1 : b.name === homeTeam ? 1 : 0))

  return (
    <div className="bg-baize border border-rail rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Enter stats</h3>
        <button onClick={onClose} className="text-xs px-2 py-1 bg-raised text-slate rounded">✕ Close</button>
      </div>

      {ordered.map(team => (
        <div key={team.id} className="space-y-2">
          <p className="text-xs font-semibold text-amber">{team.name}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {players.filter(p => p.team_id === team.id).map(p => {
              const row = rows[p.id]
              if (!row) return null
              const pts = playerPoints(row, sport)
              return (
                <div key={p.id} className="bg-table border border-rail rounded p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{p.name}</p>
                      <p className="text-xs text-slate">{p.role}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-semibold ${pts > 0 ? 'text-gold' : pts < 0 ? 'text-crimson-light' : 'text-slate'}`}>
                        {pts} pts
                      </span>
                      <button
                        type="button"
                        onClick={() => update(p.id, { played: !row.played })}
                        className={`px-3 h-11 rounded text-xs font-medium ${
                          row.played ? 'bg-amber/20 text-amber' : 'bg-raised text-slate'
                        }`}
                      >
                        {row.played ? 'Played' : 'Did not play'}
                      </button>
                    </div>
                  </div>

                  {/* An unplayed player scores zero regardless — hide the noise. */}
                  {row.played && (
                    <div className="space-y-1 pt-2 border-t border-rail">
                      {fields.map(f => (
                        <Stepper
                          key={String(f.key)}
                          label={f.label}
                          max={f.max}
                          wide={f.key === 'runs'}
                          value={(row[f.key] as number) ?? 0}
                          onChange={v => update(p.id, { [f.key]: v } as Partial<Row>)}
                        />
                      ))}
                      {sport === 'football' && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-xs text-slate w-16 shrink-0">Clean sheet</span>
                          <button
                            type="button"
                            onClick={() => update(p.id, { clean_sheet: !row.clean_sheet })}
                            className={`px-3 h-11 rounded text-xs font-medium ${
                              row.clean_sheet ? 'bg-amber/20 text-amber' : 'bg-raised text-slate'
                            }`}
                          >
                            {row.clean_sheet ? 'Yes' : 'No'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {error && <p className="text-xs text-crimson-light">{error}</p>}
      {msg && <p className="text-xs text-amber">{msg}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-amber hover:bg-amber-deep disabled:bg-rail disabled:text-slate text-white rounded text-sm font-semibold"
        >
          {saving ? 'Saving…' : 'Save stats'}
        </button>
        <span className="text-xs text-slate">Safe to save as often as you like — no money moves.</span>
      </div>
    </div>
  )
}
