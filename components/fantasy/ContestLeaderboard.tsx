'use client'

import { useEffect, useState } from 'react'
import { formatCredits } from '@/lib/credits'

type Row = {
  display_name: string
  total_points: number | null
  rank: number | null
  payout: number | null
  is_you: boolean
}

type Payload = {
  status: string
  entrants: number
  entry_fee: number
  prize_pool: number
  entries: Row[]
}

export default function ContestLeaderboard({ contestId }: { contestId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    fetch(`/api/fantasy/leaderboard?contestId=${contestId}`)
      .then(r => r.json())
      .then(j => { if (live) j.error ? setError(j.error) : setData(j) })
      .catch(() => { if (live) setError('Could not load standings') })
    return () => { live = false }
  }, [contestId])

  if (error) return <p className="text-sm text-crimson-light">{error}</p>
  if (!data) return <p className="text-sm text-slate">Loading standings…</p>

  return (
    <div className="space-y-4">
      <div className="bg-table border border-rail rounded-xl p-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-slate">Entrants</p>
          <p className="text-sm font-semibold text-white">{data.entrants}</p>
        </div>
        <div>
          <p className="text-xs text-slate">Entry</p>
          <p className="text-sm font-semibold text-white">{formatCredits(data.entry_fee)}</p>
        </div>
        <div>
          <p className="text-xs text-slate">Prize pool</p>
          <p className="text-sm font-semibold text-gold">{formatCredits(data.prize_pool)}</p>
        </div>
      </div>

      {data.status === 'open' ? (
        <div className="bg-table border border-rail rounded-xl p-6 text-center">
          <p className="text-sm text-slate">Standings appear once the contest locks.</p>
        </div>
      ) : data.entries.length === 0 ? (
        <div className="bg-table border border-rail rounded-xl p-6 text-center">
          <p className="text-sm text-slate">Nobody entered this contest.</p>
        </div>
      ) : (
        <div className="bg-table border border-rail rounded-xl overflow-hidden">
          <div className="grid grid-cols-[3rem_1fr_5rem_6rem] gap-2 px-4 py-3 border-b border-rail text-xs text-slate">
            <span>Rank</span>
            <span>Player</span>
            <span className="text-right">Points</span>
            <span className="text-right">Payout</span>
          </div>
          <ul>
            {data.entries.map((r, i) => (
              <li
                key={i}
                className={`grid grid-cols-[3rem_1fr_5rem_6rem] gap-2 px-4 py-3 border-b border-rail last:border-b-0 items-center ${
                  r.is_you ? 'border-l-2 border-l-amber bg-amber/10' : ''
                }`}
              >
                <span className="text-sm font-semibold text-white">{r.rank ?? '—'}</span>
                <span className="text-sm text-white truncate">
                  {r.display_name}
                  {r.is_you && <span className="text-amber text-xs ml-2">you</span>}
                </span>
                <span className="text-sm text-right text-white">
                  {r.total_points === null ? '—' : r.total_points}
                </span>
                <span className={`text-sm text-right font-semibold ${r.payout ? 'text-gold' : 'text-slate'}`}>
                  {r.payout ? formatCredits(r.payout) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
