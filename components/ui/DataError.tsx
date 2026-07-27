/**
 * Shown when a query fails, so a broken read never renders as an empty one.
 *
 * A swallowed error and a genuinely empty result look identical to a user —
 * that is how a fantasy contest list kept saying "No fantasy contests yet"
 * while a contest sat in the database. Empty states must only appear when the
 * data really is empty.
 *
 * The underlying error is logged server-side; users get a plain statement that
 * the fault is ours, since there is nothing they can do to fix it.
 */
export default function DataError({ what }: { what: string }) {
  return (
    <div className="bg-table border border-crimson/40 rounded-xl p-6 text-center space-y-1">
      <p className="text-sm text-crimson-light font-medium">Couldn&apos;t load {what}.</p>
      <p className="text-xs text-slate">
        Something went wrong on our side, not yours. Try again in a moment.
      </p>
    </div>
  )
}
