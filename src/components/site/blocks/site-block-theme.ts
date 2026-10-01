import type { CSSProperties } from "react"
import type { SiteFontKey } from "@/lib/site-fonts"

// Site-wide style tokens of the new builder, on top of the colour variables set by
// getSiteColorVars (src/lib/site-theme.ts). Blocks only ever use these variables — never a
// hardcoded grey or hex — so a style preset restyles every block at once.

export type SiteCornerStyle = "square" | "soft" | "round"

const CORNER_RADIUS: Record<SiteCornerStyle, string> = {
  square: "0px",
  soft:   "8px",
  round:  "16px",
}

// The public site is light-only (colorScheme: "light"), so these surfaces are fixed values.
export function getSiteStyleVars(cornerStyle: SiteCornerStyle | undefined): CSSProperties {
  return {
    "--site-radius":         CORNER_RADIUS[cornerStyle ?? "soft"],
    "--site-surface":        "#ffffff",
    "--site-surface-muted":  "#f6f7f9",
    "--site-border":         "#e5e7eb",
    "--site-text":           "#111827",
    "--site-text-muted":     "#4b5563",
  } as CSSProperties
}

export const SITE_CORNER_OPTIONS = [
  { label: "Droits",   value: "square" },
  { label: "Doux",     value: "soft" },
  { label: "Arrondis", value: "round" },
] as const

// Curated starting points: picking one fills the colours, font and corners at once, which the
// volunteer can still adjust field by field afterwards.
export type SiteStylePreset = {
  key:            string
  label:          string
  primaryColor:   string
  secondaryColor: string
  fontFamily:     SiteFontKey
  cornerStyle:    SiteCornerStyle
}

export const SITE_STYLE_PRESETS: SiteStylePreset[] = [
  { key: "classique",  label: "Classique",     primaryColor: "#1d4ed8", secondaryColor: "#111827", fontFamily: "inter",           cornerStyle: "soft" },
  { key: "nature",     label: "Nature",        primaryColor: "#2f6b3a", secondaryColor: "#1f2a1f", fontFamily: "nunito",          cornerStyle: "round" },
  { key: "solidaire",  label: "Solidaire",     primaryColor: "#c2410c", secondaryColor: "#1c1917", fontFamily: "poppins",         cornerStyle: "round" },
  { key: "culture",    label: "Culture",       primaryColor: "#7c2d12", secondaryColor: "#1e1b18", fontFamily: "playfairDisplay", cornerStyle: "square" },
  { key: "sport",      label: "Sport",         primaryColor: "#dc2626", secondaryColor: "#0f172a", fontFamily: "montserrat",      cornerStyle: "soft" },
  { key: "institution", label: "Institutionnel", primaryColor: "#0f3d68", secondaryColor: "#0b1220", fontFamily: "sourceSans",    cornerStyle: "square" },
  { key: "jeunesse",   label: "Jeunesse",      primaryColor: "#7c3aed", secondaryColor: "#1e1033", fontFamily: "spaceGrotesk",    cornerStyle: "round" },
  { key: "sobre",      label: "Sobre",         primaryColor: "#374151", secondaryColor: "#111827", fontFamily: "lora",            cornerStyle: "soft" },
]
