---
name: PrimeStake
description: A private, multi-sport sportsbook with the composure of a members' book and the density of a real live-odds terminal.
colors:
  signal-amber: "#F07820"
  burnt-amber: "#D96A18"
  odds-gold: "#FACC15"
  live-crimson: "#C41E28"
  midnight-baize: "#0D1730"
  table-navy: "#162244"
  raised-navy: "#1E2E52"
  rail-blue: "#243568"
  muted-slate: "#7A91C4"
  ink-white: "#FFFFFF"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  "2xl": "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.ink-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.burnt-amber}"
    textColor: "{colors.ink-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.raised-navy}"
    textColor: "{colors.muted-slate}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.rail-blue}"
    textColor: "{colors.muted-slate}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  bet-tile:
    backgroundColor: "{colors.raised-navy}"
    textColor: "{colors.ink-white}"
    rounded: "{rounded.md}"
    padding: "12px"
  input-field:
    backgroundColor: "{colors.midnight-baize}"
    textColor: "{colors.ink-white}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.table-navy}"
    textColor: "{colors.ink-white}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: PrimeStake

## 1. Overview

**Creative North Star: "The Private Book"**

PrimeStake looks like an exclusive members' sportsbook, not a public gambling site. The surface is a deep, near-black navy — the baize of a card table seen under low light — and every screen is built from tonal layers of that same blue rather than from shadows or borders-as-decoration. Amber is the house signal: it marks what's live, what's selected, and what pays. It is used sparingly and with intent, which is exactly why it reads as premium instead of loud. The system carries the live-odds density of a real book (Bet365) with the composed darkness of a modern trading surface (Stake) and the mobile-first polish of a top gaming app (Dream11) — but it refuses the excesses of all three.

This is a play-money app that must earn real trust, so the design behaves like a ledger: precise numbers, quiet confidence, nothing that reads as a scam. Interactive elements are tactile and confident — bet tiles and buttons feel pressable, respond immediately to hover and selection, and never leave you guessing whether a tap registered. Energy comes from live state (a pulsing "live now", odds ticking as the pool shifts, a leaderboard climbing), never from flashing offers or manufactured urgency.

The system explicitly rejects the seedy neon-casino look, the cheap school-project feel, the wall-of-blinking-numbers clutter, and the interchangeable purple-gradient SaaS template. If a screen could be mistaken for an offshore-bookie landing page or a Bootstrap demo, it has failed.

**Key Characteristics:**
- Deep-navy tonal layering, no decorative shadows — depth is built from four shades of one blue.
- Amber as a rationed signal color, never a background wash.
- Data-forward density kept legible through hierarchy, not shrunk into clutter.
- Tactile, confident interactions with clear hover/selected/disabled states.
- Mobile-first: two-column bet grids, generous tap targets, one-handed reach.

## 2. Colors

A single deep-navy family carries the entire surface; amber and gold are the only warm notes, and they are earned.

### Primary
- **Signal Amber** (#F07820): The house color. Primary buttons, the active nav link, selected bet tiles, the brand wordmark, potential-return figures, and "Betting Open" chips. This is the color of *action and money*. Its scarcity is the point — when amber appears, it means something.
- **Burnt Amber** (#D96A18): The pressed/hover state of Signal Amber only. Never used at rest.

### Secondary
- **Odds Gold** (#FACC15): Reserved exclusively for live odds figures and the early-bird ⚡ bonus. It is the one color that outranks amber for a number, because the odds are the single most-scanned datum on the screen.

### Tertiary
- **Live Crimson** (#C41E28): Live-match indicators ("🔴 live now") and destructive/exit affordances (Sign Out hover). Signals heat and finality. Never used for general emphasis.

### Neutral
- **Midnight Baize** (#0D1730): The base. Body background, the navbar, input fields, and the innermost nested panels (odds/payout summary). The floor everything sits on.
- **Table Navy** (#162244): The default card and market surface — one step up from the base.
- **Raised Navy** (#1E2E52): Interactive raised surfaces — bet tiles, secondary buttons, quick-amount chips. The layer you press.
- **Rail Blue** (#243568): Borders, dividers, and the hover fill for raised surfaces. The hairline that separates layers without a shadow.
- **Muted Slate** (#7A91C4): The single secondary-text tier — labels, inactive nav, supporting copy, pool amounts, counts, meta. Holds AA (≥4.5:1) on every surface in the navy family, so all non-white text lands here rather than dropping quieter.
- **Ink White** (#FFFFFF): Primary text, headings, and the values that must not be missed (selected option label, balance).

### Named Rules
**The Rationed Amber Rule.** Signal Amber covers a small fraction of any screen — the one primary action plus the live/selected signals. It is never a section background, never a fill behind text, never decorative. If two amber elements compete for attention on one screen, one of them is wrong.

**The One-Blue Rule.** Every surface is a shade of the Midnight Baize family (#0D1730 → #162244 → #1E2E52 → #243568). Depth is built by stepping through these four, in order, from base to top. Do not introduce a fifth neutral or a grey; the book is one color, layered.

## 3. Typography

**Display / Body Font:** Inter (with system-ui, sans-serif fallback)

**Character:** One family, worked entirely through weight and size. Inter's tabular clarity suits a book of numbers — odds, stakes, balances, pools — where digits must align and never be misread. There is no display serif and no second family; the restraint is deliberate and on-brand for "The Private Book."

### Hierarchy
- **Display** (700, 1.5rem / text-2xl, line-height 1.2): Page titles only — "BCL Tournament", a match name. One per screen.
- **Title** (700, 1.125rem / text-lg, line-height 1.3): Card and section headings, market names. Also the size of the live-odds figure on a bet tile (700, gold).
- **Body** (400, 0.875rem / text-sm, line-height 1.5): Default running text and most labels. Cap prose at 65–75ch.
- **Label** (500, 0.75rem / text-xs): Meta text, status chips, quick-amount chips, supporting counts. The smallest routine size.
- **Micro** (500, 0.625rem / text-[10px]): Reserved for bettor-name pills under a bet tile only. Do not use micro for anything a user must read to make a decision.

### Named Rules
**The Tabular Numerals Rule.** Every figure that changes or is compared — odds, stake, pool, payout, balance, leaderboard P&L — uses tabular/lining numerals so columns stay aligned and a ticking value doesn't reflow its neighbors. Money and odds are the product; treat them like a spreadsheet, not prose.

## 4. Elevation

This system is **flat by structure**. There are no drop shadows anywhere. Depth is conveyed entirely through tonal layering — a surface reads as "higher" because it is a lighter step in the navy family and is separated from its neighbor by a single 1px Rail Blue (#243568) hairline. Base (#0D1730) → card (#162244) → raised/pressable (#1E2E52), with Rail Blue as the divider throughout.

### Named Rules
**The No-Shadow Rule.** Elevation is color, not shadow. A card never casts a shadow to prove it's a card; it earns separation from a lighter tonal step and a hairline border. If a surface needs a shadow to be legible, the tonal step is too small — widen it instead.

**The Amber-Glow Exception.** The only permitted "lift" is state, not elevation: a selected bet tile or a focused input gains an amber border (or a `ring-2` amber focus ring), and a selected tile a faint amber tint (`#F07820` at ~10%). This is a signal of interaction, not a shadow, and it is the sole way an element is allowed to visually rise.

## 5. Components

### Buttons
- **Shape:** Gently rounded (8px / rounded-lg). Never pill-shaped, never square.
- **Primary:** Signal Amber (#F07820) fill, Ink White text, weight 600, padding ~8px 16px. The single most important action on any view (Confirm Bet, Sign In).
- **Hover / Focus:** Fills to Burnt Amber (#D96A18) with a `transition-colors`. Disabled drops to 50% opacity with no hover.
- **Secondary / Ghost:** Raised Navy (#1E2E52) fill, Muted Slate text; hovers to Rail Blue (#243568). Used for Cancel and low-stakes actions. Always paired *beside* a primary, never competing with it.

### Chips
- **Quick-amount chips** (₹50 / ₹100 / ₹200 / ₹500): Raised Navy fill, Muted Slate text, small radius (4px / rounded), full-width flex row. Hover to Rail Blue.
- **Status chips:** Pill-shaped (rounded-full), tinted background at ~20% opacity of the state color over its own text color — amber for "Betting Open", Rail Blue/Muted Slate for "Settled", yellow for "Closed". Never a solid fill.

### Cards / Containers
- **Corner Style:** 12px (rounded-xl) for cards and market containers; 8px for inner panels.
- **Background:** Table Navy (#162244) for cards; Midnight Baize (#0D1730) for nested summary panels (the odds/payout breakdown).
- **Shadow Strategy:** None. See Elevation — tonal step plus a 1px Rail Blue border.
- **Border:** 1px Rail Blue (#243568) on every card.
- **Internal Padding:** 20px (cards) / 12px (bet tiles) / 12–16px (summary panels).

### Bet Tile (Signature Component)
The core interactive primitive: a pressable option in a 2-up (mobile) / 3-up (tablet+) grid. Raised Navy (#1E2E52) fill, 1px Rail Blue border, 8px radius, left-aligned. Holds the option label (Ink White, 500), the live odds (Odds Gold, 700, text-lg), the pool amount (Muted Slate, text-xs), and up to four early-bird-aware bettor pills. **States:** hover lifts the border to amber-50%; selected switches to an amber border over a 10% amber tint; a settled winner takes the same amber treatment; disabled (market closed) drops to 60% opacity with `cursor-not-allowed`. This tile is where "tactile and confident" is proven — every state must be unmistakable.

### Inputs / Fields
- **Style:** Midnight Baize (#0D1730) fill — inputs sit *below* their surface, not on it — with a 1px Rail Blue border and 8px radius. Placeholder in Muted Slate.
- **Focus:** `ring-2` in Signal Amber, outline removed. No border-color-only focus; the amber ring is the tactile confirmation.

### Navigation
- **Style:** Sticky top bar, Midnight Baize fill, 1px Rail Blue bottom border, `z-50`. Amber wordmark on the left.
- **States:** Active link = Signal Amber; inactive = Muted Slate hovering to Ink White. Sign Out is the lone link that hovers to Live Crimson.
- **Mobile:** Links must remain thumb-reachable; collapse to an icon/drawer before they crowd or wrap.

## 6. Do's and Don'ts

### Do:
- **Do** build every surface from the four-step navy family (#0D1730 → #162244 → #1E2E52 → #243568) and separate layers with a 1px #243568 hairline.
- **Do** ration Signal Amber (#F07820) to the one primary action plus live/selected signals — treat its scarcity as the source of its authority.
- **Do** render every odds, stake, pool, payout, and balance figure in tabular numerals so columns align and ticking values don't reflow.
- **Do** give bet tiles, buttons, and inputs unmistakable hover / selected / focus / disabled states — the app must feel pressable and confident on every tap.
- **Do** design mobile-first: 2-column bet grids, ≥44px tap targets, one-handed reach, and a reduced-motion fallback for the live/pulsing states.
- **Do** keep all non-white text at Muted Slate (#7A91C4) or brighter — it is the single secondary tier and the quietest text the system allows. Never introduce a dimmer slate for "meta"; anything under #7A91C4 fails AA on the lighter navy surfaces.

### Don't:
- **Don't** ship a sketchy or spammy gambling look — no seedy neon-casino glow, flashing jackpots, fake "you won!" urgency, or offshore-bookie styling.
- **Don't** let it look cheap or toy-like — no clip-art, no default-framework buttons, no play-money-demo feel. This must read as a real book.
- **Don't** create a cluttered wall of tiny blinking numbers — density is earned through hierarchy; if a screen can't be parsed at a glance, cut or rank, don't shrink.
- **Don't** drift into generic AI SaaS — no purple gradients, no gradient text, no interchangeable rounded-card template.
- **Don't** add drop shadows to convey elevation — widen the tonal step instead (The No-Shadow Rule).
- **Don't** use Signal Amber as a background wash, a section fill, or a fill behind body text; it is a signal, not a surface.
- **Don't** introduce a fifth neutral or a plain grey — the book is one blue, layered.
