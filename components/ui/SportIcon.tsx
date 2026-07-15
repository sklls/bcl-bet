import type { SportType } from '@/lib/sports'

// Clean, consistent line icons for each sport — 24×24, currentColor stroke.
// Replaces OS emoji so the sports hub reads like a real book, not a toy.
const PATHS: Record<SportType, React.ReactNode> = {
  // Cricket — wicket: three stumps with the bails across the top
  cricket: (
    <>
      <path d="M7 6v13M12 6v13M17 6v13" />
      <path d="M6 6h12" />
    </>
  ),
  // Football — ball with the classic pentagon-and-seams pattern
  football: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.8l3.04 2.21-1.16 3.58h-3.76l-1.16-3.58z" />
      <path d="M12 8.8V3.5M15.04 11.01l4.94-1.6M13.88 14.59l3.02 4.29M10.12 14.59l-3.02 4.29M8.96 11.01l-4.94-1.6" />
    </>
  ),
  // Table tennis — paddle blade with a straight grip, plus the ball
  table_tennis: (
    <>
      <circle cx="10.5" cy="9.5" r="5.3" />
      <path d="M10.5 14.8V19.5" strokeWidth="3" />
      <circle cx="18" cy="6" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  // Volleyball — ball with panel seams
  volleyball: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5C9 8 8 14 7 20.2" />
      <path d="M12 3.5C15 8 16 14 17 20.2" />
      <path d="M3.8 10.5C9 13 15 13 20.2 10.5" />
    </>
  ),
  // Pool — cue ball struck by a cue
  pool: (
    <>
      <circle cx="8" cy="16" r="4.2" />
      <path d="M12.4 11.6L21 3" />
    </>
  ),
  // Basketball — ball with seams
  basketball: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M3.5 12h17" />
      <path d="M6 5.4C10 9 10 15 6 18.6" />
      <path d="M18 5.4C14 9 14 15 18 18.6" />
    </>
  ),
}

export default function SportIcon({
  sport,
  className,
}: {
  sport: SportType
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[sport]}
    </svg>
  )
}
