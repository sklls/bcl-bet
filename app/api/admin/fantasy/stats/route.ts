import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { entryPoints, type PlayerStats, type FantasySport } from '@/lib/fantasy/scoring'

const StatSchema = z.object({
  player_id:   z.string().uuid(),
  played:      z.boolean(),
  runs:        z.number().int().min(0).max(500).optional(),
  wickets:     z.number().int().min(0).max(20).optional(),
  catches:     z.number().int().min(0).max(20).optional(),
  sixes:       z.number().int().min(0).max(50).optional(),
  run_outs:    z.number().int().min(0).max(20).optional(),
  goals:       z.number().int().min(0).max(20).optional(),
  assists:     z.number().int().min(0).max(20).optional(),
  saves:       z.number().int().min(0).max(50).optional(),
  clean_sheet: z.boolean().optional(),
  yellows:     z.number().int().min(0).max(2).optional(),
  reds:        z.number().int().min(0).max(1).optional(),
})

const BodySchema = z.object({
  match_id: z.string().uuid(),
  stats:    z.array(StatSchema).min(1),
})

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

// GET /api/admin/fantasy/stats?matchId=<uuid> — rows already saved, so the
// grid opens showing what was last entered rather than a blank slate.
export async function GET(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const matchId = searchParams.get('matchId')
  if (!matchId) return NextResponse.json({ error: 'Missing matchId' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('player_match_stats')
    .select('player_id, played, runs, wickets, catches, sixes, run_outs, goals, assists, saves, clean_sheet, yellows, reds')
    .eq('match_id', matchId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ stats: data ?? [] })
}

// POST /api/admin/fantasy/stats
//
// Fully idempotent, and moves no money. Saving stats recomputes points and
// nothing else — rank, payout, wallets and contest status are settlement's
// business. That separation is deliberate: recomputing payouts after money has
// moved is the double-credit bug the betting review found.
export async function POST(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { match_id, stats } = parsed.data
  const admin = createAdminClient()

  const { data: match, error: matchErr } = await admin
    .from('matches').select('id, sport').eq('id', match_id).single()
  if (matchErr || !match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

  const sport = match.sport as FantasySport
  if (sport !== 'cricket' && sport !== 'football') {
    return NextResponse.json({ error: `Fantasy is not available for ${match.sport}` }, { status: 400 })
  }

  const rows = stats.map(s => ({
    match_id,
    player_id:   s.player_id,
    played:      s.played,
    runs:        s.runs ?? 0,
    wickets:     s.wickets ?? 0,
    catches:     s.catches ?? 0,
    sixes:       s.sixes ?? 0,
    run_outs:    s.run_outs ?? 0,
    goals:       s.goals ?? 0,
    assists:     s.assists ?? 0,
    saves:       s.saves ?? 0,
    clean_sheet: s.clean_sheet ?? false,
    yellows:     s.yellows ?? 0,
    reds:        s.reds ?? 0,
    updated_at:  new Date().toISOString(),
  }))

  const { error: upsertErr } = await admin
    .from('player_match_stats')
    .upsert(rows, { onConflict: 'match_id,player_id' })
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })

  // Reload everything for the match — the admin may have saved in batches.
  const { data: allStats, error: reloadErr } = await admin
    .from('player_match_stats')
    .select('player_id, played, runs, wickets, catches, sixes, run_outs, goals, assists, saves, clean_sheet, yellows, reds')
    .eq('match_id', match_id)
  if (reloadErr) return NextResponse.json({ error: reloadErr.message }, { status: 500 })

  const byPlayer = new Map<string, PlayerStats>(
    (allStats ?? []).map(s => [s.player_id, s as PlayerStats]),
  )

  const { data: contest } = await admin
    .from('contests').select('id').eq('match_id', match_id).maybeSingle()

  if (!contest) return NextResponse.json({ saved: rows.length, entries_scored: 0 })

  const { data: entries, error: entriesErr } = await admin
    .from('contest_entries')
    .select('id, captain_id, vice_captain_id, entry_players(player_id)')
    .eq('contest_id', contest.id)
  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 })

  let scored = 0
  for (const entry of entries ?? []) {
    const playerIds = (entry.entry_players ?? []).map((p: { player_id: string }) => p.player_id)
    const points = entryPoints(
      playerIds,
      entry.captain_id ?? '',
      entry.vice_captain_id ?? '',
      byPlayer,
      sport,
    )
    const { error } = await admin
      .from('contest_entries')
      .update({ total_points: points, updated_at: new Date().toISOString() })
      .eq('id', entry.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    scored++
  }

  return NextResponse.json({ saved: rows.length, entries_scored: scored })
}
