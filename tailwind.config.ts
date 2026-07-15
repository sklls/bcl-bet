import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── The Private Book palette (see DESIGN.md) ──────────────
        // Neutral: one blue, layered base → surface → raised → hairline
        baize:  "#0D1730", // base background, inputs, nested panels
        table:  "#162244", // card / market surface
        raised: "#1E2E52", // pressable raised surfaces
        rail:   "#243568", // borders, dividers, raised hover
        // Text on dark
        ink:    "#FFFFFF", // primary text
        slate: {
          DEFAULT: "#7A91C4", // the single secondary-text tier (AA on all surfaces)
        },
        // Signal colors
        amber: {
          DEFAULT: "#F07820", // house signal: primary action, live/selected
          deep:    "#D96A18", // hover/pressed only
        },
        gold:    "#FACC15", // live odds figures + early-bird bonus / pending
        royal:   "#1B3A8A", // "upcoming" status accent
        crimson: {
          DEFAULT: "#C41E28", // live/destructive on light or as a dot
          light:   "#FF6B74", // live text on dark surfaces (AA-safe)
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
