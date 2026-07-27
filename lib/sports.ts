export const SPORTS = {
  cricket:      { label: 'Cricket',      emoji: '🏏' },
  football:     { label: 'Football',     emoji: '⚽' },
  table_tennis: { label: 'Table Tennis', emoji: '🏓' },
  volleyball:   { label: 'Volleyball',   emoji: '🏐' },
  pool:         { label: 'Pool',         emoji: '🎱' },
  basketball:   { label: 'Basketball',   emoji: '🏀' },
} as const

export type SportType = keyof typeof SPORTS

export const ALL_SPORTS = Object.keys(SPORTS) as SportType[]

export const SPORT_MARKETS: Record<SportType, { value: string; label: string }[]> = {
  cricket: [
    { value: 'winner',      label: 'Match Winner' },
    { value: 'top_scorer',  label: 'Top Scorer' },
    { value: 'over_under',  label: 'Over / Under' },
    { value: 'custom',      label: 'Custom' },
  ],
  football: [
    { value: 'winner',              label: 'Match Winner' },
    { value: 'first_goal_scorer',   label: 'First Goal Scorer' },
    { value: 'over_under',          label: 'Over / Under (Goals)' },
    { value: 'custom',              label: 'Custom' },
  ],
  table_tennis: [
    { value: 'winner',     label: 'Match Winner' },
    { value: 'set_winner', label: 'Set Winner' },
    { value: 'handicap',   label: 'Handicap' },
    { value: 'custom',     label: 'Custom' },
  ],
  volleyball: [
    { value: 'winner',     label: 'Match Winner' },
    { value: 'set_winner', label: 'Set Winner' },
    { value: 'custom',     label: 'Custom' },
  ],
  pool: [
    { value: 'winner',          label: 'Match Winner' },
    { value: 'frame_handicap',  label: 'Frame Handicap' },
    { value: 'custom',          label: 'Custom' },
  ],
  basketball: [
    { value: 'winner',     label: 'Match Winner' },
    { value: 'over_under', label: 'Over / Under (Points)' },
    { value: 'handicap',   label: 'Handicap' },
    { value: 'custom',     label: 'Custom' },
  ],
}

// Markets that use the player-picker UI (populated from /api/admin/players)
export const PLAYER_PICKER_MARKETS = new Set(['top_scorer', 'first_goal_scorer'])

/** Sports that additionally offer a Dream11-style fantasy league. */
export const FANTASY_SPORTS = ['cricket', 'football'] as const
export type FantasySportType = typeof FANTASY_SPORTS[number]
export const hasFantasy = (sport: string): sport is FantasySportType =>
  (FANTASY_SPORTS as readonly string[]).includes(sport)
