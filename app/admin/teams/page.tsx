'use client'

import { useState, useEffect, useCallback } from 'react'
import { SPORTS, ALL_SPORTS, SportType } from '@/lib/sports'

type Team = { id: string; name: string; sport: SportType }

export default function AdminTeamsPage() {
  const [activeSport, setActiveSport] = useState<SportType>('cricket')
  const [teams, setTeams] = useState<Team[]>([])
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const loadTeams = useCallback(async () => {
    const res = await fetch(`/api/admin/teams?sport=${activeSport}`)
    if (res.ok) setTeams(await res.json())
  }, [activeSport])

  useEffect(() => { loadTeams() }, [loadTeams])

  async function addTeam(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setLoading(true)
    const res = await fetch('/api/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), sport: activeSport }),
    })
    if (res.ok) {
      setNewName('')
      setMsg(`Team added to ${SPORTS[activeSport].label}.`)
      loadTeams()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error adding team')
    }
    setLoading(false)
  }

  async function deleteTeam(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/teams/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setMsg(`"${name}" deleted.`)
      loadTeams()
    } else {
      const d = await res.json()
      setMsg(d.error ?? 'Error deleting team')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Manage Teams</h1>
        <p className="text-slate text-sm mt-1">Add teams per sport before creating matches</p>
      </div>

      {msg && (
        <p className="text-sm px-3 py-2 bg-raised border border-rail rounded-lg text-slate">
          {msg}
        </p>
      )}

      {/* Sport tabs */}
      <div className="flex flex-wrap gap-2">
        {ALL_SPORTS.map(sport => (
          <button
            key={sport}
            onClick={() => { setActiveSport(sport); setMsg('') }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSport === sport
                ? 'bg-amber text-white'
                : 'bg-table text-slate border border-rail hover:border-amber/50'
            }`}
          >
            {SPORTS[sport].emoji} {SPORTS[sport].label}
          </button>
        ))}
      </div>

      {/* Add team form */}
      <form onSubmit={addTeam} className="flex gap-2">
        <input
          required
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder={`New ${SPORTS[activeSport].label} team name`}
          className="flex-1 px-3 py-2 bg-raised border border-rail rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-amber hover:bg-amber-deep text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          + Add
        </button>
      </form>

      {/* Teams list */}
      <div className="space-y-2">
        {teams.length === 0 ? (
          <p className="text-slate text-sm py-6 text-center">
            No {SPORTS[activeSport].label} teams yet. Add one above.
          </p>
        ) : (
          teams.map(team => (
            <div
              key={team.id}
              className="flex items-center justify-between bg-table border border-rail rounded-lg px-4 py-3"
            >
              <span className="text-white text-sm font-medium">{team.name}</span>
              <button
                onClick={() => deleteTeam(team.id, team.name)}
                className="text-xs px-2 py-1 bg-crimson/10 hover:bg-crimson/20 text-crimson-light rounded transition-colors"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
