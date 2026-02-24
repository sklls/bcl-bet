'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

export default function LiveScoreCard({
  matchId,
  initialScoreA,
  initialScoreB,
  teamA,
  teamB,
}: {
  matchId: string
  initialScoreA: string | null
  initialScoreB: string | null
  teamA: string
  teamB: string
}) {
  const [scoreA, setScoreA] = useState(initialScoreA)
  const [scoreB, setScoreB] = useState(initialScoreB)
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel(`live-score-${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => {
          const d = payload.new as { live_score_a: string; live_score_b: string }
          if (d.live_score_a) setScoreA(d.live_score_a)
          if (d.live_score_b) setScoreB(d.live_score_b)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [matchId])

  return (
    <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        <span className="text-red-400 text-xs font-semibold">LIVE SCORE</span>
        <span className="text-xs text-gray-500 ml-auto">Updates every ~60s</span>
      </div>
      <div className="flex justify-around">
        <div className="text-center">
          <p className="text-sm text-gray-400">{teamA}</p>
          <p className="text-xl font-bold text-white font-mono">{scoreA ?? '—'}</p>
        </div>
        <div className="text-gray-600 self-center">|</div>
        <div className="text-center">
          <p className="text-sm text-gray-400">{teamB}</p>
          <p className="text-xl font-bold text-white font-mono">{scoreB ?? '—'}</p>
        </div>
      </div>
    </div>
  )
}
