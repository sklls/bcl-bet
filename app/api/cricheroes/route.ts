import { NextResponse } from 'next/server'

export interface CricHeroesMatchData {
  status: 'live' | 'past' | 'upcoming'
  team_a: string
  team_b: string
  score_a: string | null
  score_b: string | null
  overs_a: string | null
  overs_b: string | null
  crr_a: string | null
  crr_b: string | null
  result: string | null
  winning_team: string | null
  top_batters: TopBatter[]
  toss: string | null
}

export interface TopBatter {
  player_name: string
  team_name: string
  runs: number
  balls: number
  fours: number
  sixes: number
  strike_rate: string
  inning: number
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const matchId = searchParams.get('matchId')
  const slug = searchParams.get('slug')

  if (!matchId) {
    return NextResponse.json({ error: 'matchId required' }, { status: 400 })
  }

  const url = slug
    ? `https://cricheroes.com/scorecard/${matchId}/${slug}/summary`
    : `https://cricheroes.com/scorecard/${matchId}/summary`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      return NextResponse.json({ error: `CricHeroes returned ${res.status}` }, { status: 502 })
    }

    const html = await res.text()

    // Extract __NEXT_DATA__ JSON blob
    const scriptMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (!scriptMatch) {
      return NextResponse.json({ error: 'Could not parse CricHeroes page' }, { status: 502 })
    }

    const nextData = JSON.parse(scriptMatch[1])
    const summary = nextData?.props?.pageProps?.summaryData

    if (!summary?.status || !summary?.data) {
      return NextResponse.json({ error: 'Match data not available' }, { status: 404 })
    }

    const d = summary.data

    const teamA = d.team_a
    const teamB = d.team_b
    const inningsA = teamA.innings?.[0]
    const inningsB = teamB.innings?.[0]

    const topBatters: TopBatter[] = (d.best_performances?.batting ?? []).map(
      (b: {
        player_name: string
        team_name: string
        runs: number
        balls: number
        '4s': number
        '6s': number
        strike_rate: string
        inning: number
      }) => ({
        player_name: b.player_name,
        team_name: b.team_name,
        runs: b.runs,
        balls: b.balls,
        fours: b['4s'],
        sixes: b['6s'],
        strike_rate: b.strike_rate,
        inning: b.inning,
      })
    )

    const result: CricHeroesMatchData = {
      status: d.status,
      team_a: teamA.name,
      team_b: teamB.name,
      score_a: teamA.summary ?? null,
      score_b: teamB.summary ?? null,
      overs_a: inningsA?.overs_played ?? null,
      overs_b: inningsB?.overs_played ?? null,
      crr_a: inningsA?.summary?.rr ?? null,
      crr_b: inningsB?.summary?.rr ?? null,
      result: d.win_by ? `${d.winning_team} won by ${d.win_by}` : null,
      winning_team: d.winning_team ?? null,
      top_batters: topBatters,
      toss: d.toss_details ?? null,
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('CricHeroes fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch match data' }, { status: 500 })
  }
}
