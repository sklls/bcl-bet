import { describe, it, expect } from 'vitest'
import {
  playerPoints, entryPoints, CAPTAIN_MULTIPLIER, VICE_CAPTAIN_MULTIPLIER,
  type PlayerStats,
} from './scoring'

const blank = (over: Partial<PlayerStats> = {}): PlayerStats => ({
  player_id: 'p', played: true, runs: 0, wickets: 0, catches: 0, sixes: 0, run_outs: 0,
  goals: 0, assists: 0, saves: 0, clean_sheet: false, yellows: 0, reds: 0, ...over,
})

describe('playerPoints — cricket', () => {
  it('gives 2 for turning up', () => {
    expect(playerPoints(blank(), 'cricket')).toBe(2)
  })

  it('scores nothing at all for a player who did not play', () => {
    expect(playerPoints(blank({ played: false, runs: 50 }), 'cricket')).toBe(0)
  })

  it('adds 1 per run', () => {
    expect(playerPoints(blank({ runs: 50 }), 'cricket')).toBe(52)
  })

  it('adds 25 per wicket, so 3 wickets beats a fifty', () => {
    const bowler = playerPoints(blank({ wickets: 3 }), 'cricket')
    const batter = playerPoints(blank({ runs: 50 }), 'cricket')
    expect(bowler).toBe(77)
    expect(bowler).toBeGreaterThan(batter)
  })

  it('adds 8 per catch and 12 per run-out', () => {
    expect(playerPoints(blank({ catches: 2, run_outs: 1 }), 'cricket')).toBe(30)
  })

  it('adds a 2-point bonus per six on top of the runs', () => {
    // 30 runs including two sixes: 30 + 2*2 + 2 played
    expect(playerPoints(blank({ runs: 30, sixes: 2 }), 'cricket')).toBe(36)
  })

  it('ignores football stats when scoring cricket', () => {
    expect(playerPoints(blank({ goals: 5 }), 'cricket')).toBe(2)
  })
})

describe('playerPoints — football', () => {
  it('adds 10 per goal and 6 per assist', () => {
    expect(playerPoints(blank({ goals: 2, assists: 1 }), 'football')).toBe(28)
  })

  it('adds 3 per save and 6 for a clean sheet', () => {
    expect(playerPoints(blank({ saves: 4, clean_sheet: true }), 'football')).toBe(20)
  })

  it('subtracts 2 per yellow and 6 per red', () => {
    expect(playerPoints(blank({ yellows: 1, reds: 1 }), 'football')).toBe(-6)
  })

  it('can go negative overall', () => {
    expect(playerPoints(blank({ reds: 2 }), 'football')).toBe(-10)
  })

  it('ignores cricket stats when scoring football', () => {
    expect(playerPoints(blank({ wickets: 3 }), 'football')).toBe(2)
  })
})

describe('entryPoints', () => {
  const stats = new Map<string, PlayerStats>([
    ['a', blank({ player_id: 'a', runs: 50 })],   // 52
    ['b', blank({ player_id: 'b', wickets: 2 })], // 52
    ['c', blank({ player_id: 'c', catches: 1 })], // 10
  ])

  it('doubles the captain and multiplies the vice by 1.5', () => {
    // 52*2 + 52*1.5 + 10 = 104 + 78 + 10
    expect(entryPoints(['a', 'b', 'c'], 'a', 'b', stats, 'cricket')).toBe(192)
  })

  it('treats a player with no stats row as zero', () => {
    expect(entryPoints(['a', 'zzz'], 'a', 'zzz', stats, 'cricket')).toBe(104)
  })

  it('does not stack both multipliers on one player', () => {
    expect(entryPoints(['a'], 'a', 'a', stats, 'cricket')).toBe(52 * CAPTAIN_MULTIPLIER)
  })

  it('applies the vice multiplier to a negative score too', () => {
    const s = new Map([['x', blank({ player_id: 'x', reds: 1 })]]) // -4
    expect(entryPoints(['x'], 'none', 'x', s, 'football')).toBe(-4 * VICE_CAPTAIN_MULTIPLIER)
  })

  it('rounds to two decimals so 1.5x never leaves float dust', () => {
    const s = new Map([['y', blank({ player_id: 'y', runs: 33 })]]) // 35
    expect(entryPoints(['y'], 'none', 'y', s, 'cricket')).toBe(52.5)
  })
})
