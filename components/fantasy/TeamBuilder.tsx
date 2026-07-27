'use client'

import { useMemo, useState } from 'react'
import {
  validateLineup, lineupCost,
  CREDIT_BUDGET, SQUAD_SIZE, MAX_PER_TEAM,
  type SelectablePlayer, type LineupError,
} from '@/lib/fantasy/lineup'
import type { FantasySport } from '@/lib/fantasy/scoring'
import { formatCredits } from '@/lib/credits'

type Team = { id: string; name: string }

type ExistingEntry = {
  id: string
  player_ids: string[]
  captain_id: string | null
  vice_captain_id: string | null
}

export default function TeamBuilder({
  contestId, entryFee, sport, teams, players, balance, existingEntry,
}: {
  contestId: string
  entryFee: number
  sport: FantasySport
  teams: Team[]
  players: SelectablePlayer[]
  balance: number | null
  existingEntry: ExistingEntry | null
}) {
  const [selected, setSelected]   = useState<string[]>(existingEntry?.player_ids ?? [])
  const [captainId, setCaptain]   = useState<string>(existingEntry?.captain_id ?? '')
  const [viceId, setVice]         = useState<string>(existingEntry?.vice_captain_id ?? '')
  const [entered, setEntered]     = useState<boolean>(!!existingEntry)
  const [saving, setSaving]       = useState(false)
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [flash, setFlash]         = useState('')

  const byId = useMemo(() => {
    const m: Record<string, SelectablePlayer> = {}
    for (const p of players) m[p.id] = p
    return m
  }, [players])

  const cost = lineupCost(selected, players)
  const remaining = Math.round((CREDIT_BUDGET - cost) * 100) / 100

  const perTeam = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const id of selected) {
      const p = byId[id]
      if (p) counts[p.team_id] = (counts[p.team_id] ?? 0) + 1
    }
    return counts
  }, [selected, byId])

  const errors: LineupError[] = useMemo(
    () => validateLineup({ playerIds: selected, captainId, viceCaptainId: viceId }, players, sport),
    [selected, captainId, viceId, players, sport],
  )

  const isSelected = (id: string) => selected.indexOf(id) !== -1

  /**
   * A pick that would breach the squad size, the budget or the per-team cap is
   * rendered dead rather than erroring on tap — the rule becomes discoverable
   * without anyone having to read a message.
   */
  function blockedReason(p: SelectablePlayer): string | null {
    if (isSelected(p.id)) return null
    if (selected.length >= SQUAD_SIZE) return 'XI full'
    if (cost + Number(p.credits) > CREDIT_BUDGET) return 'Too expensive'
    if ((perTeam[p.team_id] ?? 0) >= MAX_PER_TEAM) return `Max ${MAX_PER_TEAM}`
    return null
  }

  function toggle(p: SelectablePlayer) {
    if (isSelected(p.id)) {
      setSelected(selected.filter(id => id !== p.id))
      if (captainId === p.id) setCaptain('')
      if (viceId === p.id) setVice('')
    } else {
      if (blockedReason(p)) return
      setSelected(selected.concat(p.id))
    }
    setFlash('')
    setServerErrors([])
  }

  function pickCaptain(id: string) {
    setCaptain(id)
    if (viceId === id) setVice('')
  }
  function pickVice(id: string) {
    setVice(id)
    if (captainId === id) setCaptain('')
  }

  const needsFunds = !entered && balance !== null && balance < entryFee
  const canSubmit = errors.length === 0 && !saving && !needsFunds

  async function submit() {
    setSaving(true)
    setServerErrors([])
    setFlash('')

    const res = await fetch('/api/fantasy/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contest_id:      contestId,
        player_ids:      selected,
        captain_id:      captainId,
        vice_captain_id: viceId,
      }),
    })
    const json = await res.json()
    setSaving(false)

    if (!res.ok) {
      // The server is the authority and may reject what the client allowed.
      if (Array.isArray(json.errors)) setServerErrors(json.errors.map((e: LineupError) => e.message))
      else setServerErrors([json.error ?? 'Something went wrong'])
      return
    }

    setEntered(true)
    setFlash(json.charged ? `You're in — ${formatCredits(entryFee)} entry` : 'Lineup updated')
  }

  const overBudget = cost > CREDIT_BUDGET
  const barPct = Math.min(100, (cost / CREDIT_BUDGET) * 100)

  return (
    <div className="space-y-4">
      {/* ── Sticky budget header ─────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-baize border border-rail rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className={overBudget ? 'text-crimson-light font-semibold' : 'text-white font-semibold'}>
            {cost} / {CREDIT_BUDGET} squad credits
          </span>
          <span className={selected.length === SQUAD_SIZE ? 'text-amber font-semibold' : 'text-slate'}>
            {selected.length}/{SQUAD_SIZE} picked
          </span>
        </div>
        <div className="h-2 bg-table rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${overBudget ? 'bg-crimson' : 'bg-amber'}`}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <p className={`text-xs ${overBudget ? 'text-crimson-light' : 'text-slate'}`}>
          {overBudget ? `Over budget by ${Math.abs(remaining)}` : `${remaining} squad credits left`}
        </p>
      </div>

      {/* ── Two squads ───────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {teams.map(team => {
          const squad = players.filter(p => p.team_id === team.id)
          const count = perTeam[team.id] ?? 0
          return (
            <div key={team.id} className="bg-table border border-rail rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-rail">
                <h3 className="font-bold text-white">{team.name}</h3>
                <span className={`text-xs font-medium ${count >= MAX_PER_TEAM ? 'text-amber' : 'text-slate'}`}>
                  {count}/{MAX_PER_TEAM}
                </span>
              </div>
              <ul>
                {squad.map(p => {
                  const on = isSelected(p.id)
                  const blocked = blockedReason(p)
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => toggle(p)}
                        disabled={!!blocked}
                        className={`w-full text-left px-4 py-3 min-h-[44px] border-b border-rail last:border-b-0 flex items-center justify-between gap-3 transition-colors ${
                          on ? 'border-l-2 border-l-amber bg-amber/10'
                             : blocked ? 'opacity-50 cursor-not-allowed'
                             : 'hover:bg-raised'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm text-white truncate">{p.name}</span>
                          <span className="block text-xs text-slate">{p.role}</span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className="block text-sm font-semibold text-gold">{Number(p.credits)}</span>
                          {blocked && <span className="block text-[10px] text-slate">{blocked}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      {/* ── Captain / vice-captain ───────────────────────────── */}
      {selected.length === SQUAD_SIZE && (
        <div className="bg-table border border-rail rounded-xl p-4 space-y-4">
          {([
            { label: 'Captain', hint: '2× points',   value: captainId, pick: pickCaptain, other: viceId },
            { label: 'Vice-captain', hint: '1.5× points', value: viceId, pick: pickVice, other: captainId },
          ] as const).map(row => (
            <div key={row.label}>
              <p className="text-xs text-slate mb-2">
                {row.label} <span className="text-gold">{row.hint}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {selected.map(id => {
                  const p = byId[id]
                  if (!p) return null
                  const on = row.value === id
                  const taken = row.other === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => row.pick(id)}
                      disabled={taken}
                      className={`px-3 py-2 min-h-[44px] rounded-lg text-xs border transition-colors ${
                        on ? 'border-amber bg-amber/10 text-white'
                           : taken ? 'border-rail text-slate opacity-50 cursor-not-allowed'
                           : 'border-rail text-slate hover:bg-raised'
                      }`}
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Outstanding rules ────────────────────────────────── */}
      {errors.length > 0 && (
        <ul className="bg-table border border-rail rounded-xl p-4 space-y-1">
          {errors.map(e => (
            <li key={e.code} className="text-xs text-slate flex gap-2">
              <span className="text-crimson-light">•</span>{e.message}
            </li>
          ))}
        </ul>
      )}

      {serverErrors.length > 0 && (
        <ul className="bg-table border border-crimson rounded-xl p-4 space-y-1">
          {serverErrors.map((m, i) => (
            <li key={i} className="text-xs text-crimson-light">{m}</li>
          ))}
        </ul>
      )}

      {/* ── Submit ───────────────────────────────────────────── */}
      <div className="bg-table border border-rail rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate">Entry fee</span>
          <span className="font-semibold text-white">{formatCredits(entryFee)}</span>
        </div>
        {balance !== null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate">Your balance</span>
            <span className={`font-semibold ${needsFunds ? 'text-crimson-light' : 'text-white'}`}>
              {formatCredits(balance)}
            </span>
          </div>
        )}

        {flash && <p className="text-sm text-amber font-medium">{flash}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`w-full min-h-[44px] rounded-lg font-semibold transition-colors ${
            canSubmit ? 'bg-amber hover:bg-amber-deep text-white' : 'bg-rail text-slate cursor-not-allowed'
          }`}
        >
          {saving ? 'Saving…'
            : needsFunds ? 'Not enough balance'
            : entered ? 'Update lineup'
            : `Join for ${formatCredits(entryFee)}`}
        </button>

        {entered && (
          <p className="text-xs text-slate text-center">
            Editing is free until the contest locks.
          </p>
        )}
      </div>
    </div>
  )
}
