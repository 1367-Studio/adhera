import {
  Inter, Roboto, Poppins, Montserrat, Nunito, Source_Sans_3,
  Playfair_Display, Merriweather, Lora, Space_Grotesk,
} from "next/font/google"

// A curated set, not the full Google Fonts catalogue — keeps every association's site
// legible and visually consistent with the rest of Formwise, per CLAUDE.md's "restrained,
// not decorative" rule. next/font/google needs a static import per font (can't pick one
// dynamically at request time), so all 10 are loaded here once and selected by CSS variable
// at the [slug] layout level (see src/app/[slug]/layout.tsx).
const inter           = Inter({ subsets: ["latin"], variable: "--font-site-inter", display: "swap" })
const roboto           = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-site-roboto", display: "swap" })
const poppins           = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-site-poppins", display: "swap" })
const montserrat       = Montserrat({ subsets: ["latin"], variable: "--font-site-montserrat", display: "swap" })
const nunito           = Nunito({ subsets: ["latin"], variable: "--font-site-nunito", display: "swap" })
const sourceSans       = Source_Sans_3({ subsets: ["latin"], variable: "--font-site-source-sans", display: "swap" })
const playfairDisplay = Playfair_Display({ subsets: ["latin"], variable: "--font-site-playfair-display", display: "swap" })
const merriweather     = Merriweather({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-site-merriweather", display: "swap" })
const lora             = Lora({ subsets: ["latin"], variable: "--font-site-lora", display: "swap" })
const spaceGrotesk     = Space_Grotesk({ subsets: ["latin"], variable: "--font-site-space-grotesk", display: "swap" })

export type SiteFontKey =
  | "inter" | "roboto" | "poppins" | "montserrat" | "nunito"
  | "sourceSans" | "playfairDisplay" | "merriweather" | "lora" | "spaceGrotesk"

export const SITE_DEFAULT_FONT: SiteFontKey = "inter"

export const SITE_FONTS: Record<SiteFontKey, { variable: string; cssVar: string; label: string }> = {
  inter:           { variable: inter.variable,           cssVar: "var(--font-site-inter)",            label: "Inter" },
  roboto:          { variable: roboto.variable,          cssVar: "var(--font-site-roboto)",            label: "Roboto" },
  poppins:         { variable: poppins.variable,         cssVar: "var(--font-site-poppins)",           label: "Poppins" },
  montserrat:      { variable: montserrat.variable,      cssVar: "var(--font-site-montserrat)",        label: "Montserrat" },
  nunito:          { variable: nunito.variable,          cssVar: "var(--font-site-nunito)",            label: "Nunito" },
  sourceSans:      { variable: sourceSans.variable,      cssVar: "var(--font-site-source-sans)",       label: "Source Sans 3" },
  playfairDisplay: { variable: playfairDisplay.variable, cssVar: "var(--font-site-playfair-display)",  label: "Playfair Display" },
  merriweather:    { variable: merriweather.variable,    cssVar: "var(--font-site-merriweather)",      label: "Merriweather" },
  lora:            { variable: lora.variable,            cssVar: "var(--font-site-lora)",              label: "Lora" },
  spaceGrotesk:    { variable: spaceGrotesk.variable,    cssVar: "var(--font-site-space-grotesk)",     label: "Space Grotesk" },
}

export const SITE_FONT_KEYS = Object.keys(SITE_FONTS) as SiteFontKey[]

export function isSiteFontKey(value: string | undefined): value is SiteFontKey {
  return !!value && (SITE_FONT_KEYS as string[]).includes(value)
}
