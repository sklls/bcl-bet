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
    <div className="bg-[#C41E28]/20 border border-[#C41E28]/30 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 bg-[#C41E28] rounded-full animate-pulse" />
        <span className="text-[#C41E28] text-xs font-semibold">LIVE SCORE</span>
        <span className="text-xs text-[#5a7099] ml-auto">Updates every ~60s</span>
      </div>
      <div className="flex justify-around">
        <div className="text-center">
          <p className="text-sm text-[#7a91c4]">{teamA}</p>
          <p className="text-xl font-bold text-white font-mono">{scoreA ?? '—'}</p>
        </div>
        <div className="text-[#243568] self-center">|</div>
        <div className="text-center">
          <p className="text-sm text-[#7a91c4]">{teamB}</p>
          <p className="text-xl font-bold text-white font-mono">{scoreB ?? '—'}</p>
        </div>
      </div>
    </div>
  )
}
