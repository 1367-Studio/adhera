"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"

// ─── Palette (validated — see docs/audit-2026-07-06.md conventions / dataviz skill) ──
// Light/dark steps from the reference categorical palette; assignment (which hue means
// which entity) is fixed and never re-derived from the data, only the L/C step swaps
// per mode. Shared between finance-charts.tsx and the dashboard stat cards so a
// "en attente" yellow or a "solde négatif" red always means the same thing everywhere
// on the dashboard, instead of each screen picking its own unrelated color.

export function usePalette() {
  const { resolvedTheme } = useTheme()
  // next-themes can't know the real theme during SSR (it lives in localStorage), so the
  // server always renders as if light. Mirroring that on the client's first paint too —
  // instead of trusting resolvedTheme immediately — avoids a hydration mismatch on
  // anything that renders real HTML from this hook (e.g. the dashboard stat cards' inline
  // background-color). The one-frame flash back to light-mode values for dark-mode users
  // is the standard, accepted tradeoff for this pattern.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const dark = mounted && resolvedTheme === "dark"
  return {
    dark,
    recettes:   "#008300",                  // green — identical step both modes
    // Vibrant, brand-anchored set (validated: node scripts/validate_palette.js
    // "#008300,#e11d48,#f59e0b,#0369a1" --mode light / the dark equivalents below —
    // ALL CHECKS PASS in both). Replaces an earlier muted/earthy set that read as dated
    // and used a blue unrelated to the app's own primary.
    depenses:   dark ? "#f43f5e" : "#e11d48", // rose-red
    payees:     "#008300",                  // green
    // Amber WARNs the contrast check (2.09:1 light) but that's explicitly legal here per
    // the dataviz skill: "a contrast WARN obligates visible labels... not dismissable" —
    // every use of this color already ships with a text label right next to it (legend
    // rows, stat card copy), so the WARN's condition is satisfied, not ignored.
    enAttente:  dark ? "#c98500" : "#f59e0b", // amber
    // Light step is the app's actual primary (--primary in globals.css) — same blue as
    // buttons/sidebar, not a lookalike. Dark step stays a tuned sky blue rather than the
    // brand's dark primary (--primary dark, #38bdf8): that one is optimized for text/icon
    // contrast on near-black and sits outside the categorical lightness band as a fill.
    exonerees:  dark ? "#3987e5" : "#0369a1", // blue
    sequential: dark ? "#3987e5" : "#0369a1", // blue, single hue for magnitude ranking
    axis:       "#898781",                   // muted ink — same both modes
    grid:       dark ? "#2c2c2a" : "#e1e0d9", // hairline gridline
    cursor:     dark ? "rgba(255,255,255,0.06)" : "rgba(11,11,11,0.05)",
  }
}

// Tints a semantic hex color for use as an icon chip background, keeping the same hue
// the icon itself uses instead of an unrelated Tailwind shade.
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "")
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
