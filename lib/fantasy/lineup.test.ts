import { describe, it, expect } from 'vitest'
import { validateLineup, lineupCost, type SelectablePlayer } from './lineup'

/** 14 cricketers per team, priced so budget pressure is realistic. */
function cricketPool(): SelectablePlayer[] {
  const out: SelectablePlayer[] = []
  for (const team of ['T1', 'T2']) {
    for (let i = 0; i < 14; i++) {
      out.push({
        id: `${team}-${i}`,
        name: `${team} Player ${i}`,
        role: 'Novice',
        credits: i < 4 ? 11 : i < 8 ? 8.5 : 6.5,
        team_id: team,
      })
    }
  }
  return out
}

function footballPool(): SelectablePlayer[] {
  const out: SelectablePlayer[] = []
  for (const team of ['T1', 'T2']) {
    const shape: [string, number][] = [['GK', 2], ['DEF', 5], ['MID', 5], ['FWD', 2]]
    for (const [role, count] of shape) {
      for (let k = 0; k < count; k++) {
        out.push({ id: `${team}-${role}-${k}`, name: `${role}${k}`, role, credits: 7, team_id: team })
      }
    }
  }
  return out
}

const codes = (errs: { code: string }[]) => errs.map(e => e.code).sort()

describe('lineupCost', () => {
  it('sums credits and copes with NUMERIC strings from PostgREST', () => {
    const pool: SelectablePlayer[] = [
      { id: 'a', name: 'A', role: 'x', credits: '7.5', team_id: 'T1' },
      { id: 'b', name: 'B', role: 'x', credits: 9, team_id: 'T1' },
    ]
    expect(lineupCost(['a', 'b'], pool)).toBe(16.5)
  })

  it('ignores ids that are not in the pool', () => {
    expect(lineupCost(['ghost'], [])).toBe(0)
  })
})

describe('validateLineup — cricket', () => {
  const pool = cricketPool()
  // 4 cheap from T1, 4 cheap from T2, 3 mid — 7 max per team respected
  const legal = ['T1-8','T1-9','T1-10','T1-11','T2-8','T2-9','T2-10','T2-11','T1-4','T2-4','T2-5']

  it('accepts a legal XI', () => {
    expect(validateLineup({ playerIds: legal, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')).toEqual([])
  })

  it('rejects the wrong number of players', () => {
    const errs = validateLineup({ playerIds: legal.slice(0, 10), captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('SQUAD_SIZE')
  })

  it('rejects going over budget', () => {
    const rich = ['T1-0','T1-1','T1-2','T1-3','T2-0','T2-1','T2-2','T2-3','T1-4','T2-4','T2-5']
    const errs = validateLineup({ playerIds: rich, captainId: 'T1-0', viceCaptainId: 'T2-0' }, pool, 'cricket')
    expect(codes(errs)).toContain('OVER_BUDGET')
  })

  it('rejects more than 7 from one team', () => {
    const stacked = ['T1-8','T1-9','T1-10','T1-11','T1-12','T1-13','T1-4','T1-5','T2-8','T2-9','T2-10']
    const errs = validateLineup({ playerIds: stacked, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('MAX_PER_TEAM')
  })

  it('rejects duplicate picks', () => {
    const dupes = ['T1-8','T1-8','T1-10','T1-11','T2-8','T2-9','T2-10','T2-11','T1-4','T2-4','T2-5']
    const errs = validateLineup({ playerIds: dupes, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('DUPLICATE_PLAYER')
  })

  it('rejects a player who is not in either squad', () => {
    const alien = [...legal.slice(0, 10), 'SOMEONE-ELSE']
    const errs = validateLineup({ playerIds: alien, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('UNKNOWN_PLAYER')
  })

  it('requires the captain to be in the XI', () => {
    const errs = validateLineup({ playerIds: legal, captainId: 'T1-0', viceCaptainId: 'T2-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('CAPTAIN_NOT_IN_SQUAD')
  })

  it('requires captain and vice to be different people', () => {
    const errs = validateLineup({ playerIds: legal, captainId: 'T1-8', viceCaptainId: 'T1-8' }, pool, 'cricket')
    expect(codes(errs)).toContain('CAPTAIN_IS_VICE')
  })

  it('applies no positional quotas to cricket', () => {
    // every pick is a 'Novice'; football would reject this outright
    expect(validateLineup({ playerIds: legal, captainId: 'T1-8', viceCaptainId: 'T2-8' }, pool, 'cricket')).toEqual([])
  })
})

describe('validateLineup — football', () => {
  const pool = footballPool()
  const legal = [
    'T1-GK-0',
    'T1-DEF-0','T1-DEF-1','T2-DEF-0',
    'T1-MID-0','T1-MID-1','T2-MID-0',
    'T1-FWD-0','T2-FWD-0',
    'T2-DEF-1','T2-MID-1',
  ]

  it('accepts a legal XI of 1 GK, 4 DEF, 4 MID, 2 FWD', () => {
    expect(validateLineup({ playerIds: legal, captainId: 'T1-FWD-0', viceCaptainId: 'T1-MID-0' }, pool, 'football')).toEqual([])
  })

  it('rejects a lineup with no goalkeeper', () => {
    const noGk = [...legal.slice(1), 'T2-DEF-2']
    const errs = validateLineup({ playerIds: noGk, captainId: 'T1-FWD-0', viceCaptainId: 'T1-MID-0' }, pool, 'football')
    expect(codes(errs)).toContain('QUOTA_GK')
  })

  it('rejects two goalkeepers', () => {
    const twoGk = ['T1-GK-0','T2-GK-0', ...legal.slice(1, 10)]
    const errs = validateLineup({ playerIds: twoGk, captainId: 'T1-FWD-0', viceCaptainId: 'T1-MID-0' }, pool, 'football')
    expect(codes(errs)).toContain('QUOTA_GK')
  })

  it('rejects too few defenders', () => {
    const thinBack = ['T1-GK-0','T1-DEF-0','T1-MID-0','T1-MID-1','T2-MID-0','T2-MID-1','T1-FWD-0','T2-FWD-0','T1-MID-2','T2-MID-2','T2-MID-3']
    const errs = validateLineup({ playerIds: thinBack, captainId: 'T1-FWD-0', viceCaptainId: 'T1-MID-0' }, pool, 'football')
    expect(codes(errs)).toContain('QUOTA_DEF')
  })

  it('reports every violation at once rather than stopping at the first', () => {
    const errs = validateLineup({ playerIds: ['T1-GK-0'], captainId: 'nope', viceCaptainId: 'nope' }, pool, 'football')
    expect(errs.length).toBeGreaterThan(1)
  })
})
