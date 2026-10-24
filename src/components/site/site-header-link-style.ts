import type { CSSProperties } from "react"
import type { SiteLink } from "@/components/site/blocks/site-block-fields"

// Shared by SiteNavbar (header links, Adhérer, Se connecter) and SiteHeaderAdhesionMenu (the
// dropdown trigger) — its own file so the two don't import each other.

export type HeaderPillVariant = "primary" | "outline" | "ghost"
export type HeaderLinkItem = SiteLink & { variant?: HeaderPillVariant }

export const HEADER_PILL_VARIANT_OPTIONS = [
  { label: "Couleur principale", value: "primary" },
  { label: "Contour",            value: "outline" },
  { label: "Sans bordure",       value: "ghost" },
]

// "primary" is a filled CTA (dims on hover/active, like any solid button); "outline" keeps a
// border, "ghost" has none — both of those tint toward the link's own color (currentColor)
// instead of a flat opacity fade, so the control still reads against busy header backgrounds.
export function headerPillClassName(variant: HeaderPillVariant = "outline"): string {
  const base = "text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
  if (variant === "primary") return `${base} hover:opacity-90 active:opacity-80`
  const tinted = `${base} hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)] active:bg-[color-mix(in_srgb,currentColor_16%,transparent)]`
  return variant === "outline" ? `${tinted} border` : tinted
}

// `accent` is whatever color this particular control resolved (the brand primary for a
// "primary"-variant control, secondaryColor ?? color for the rest — the caller decides which,
// since that's a per-control choice, not something this shared helper can know).
export function headerPillStyle(variant: HeaderPillVariant, accent: string, foreground = "var(--site-primary-foreground)"): CSSProperties {
  if (variant === "primary") return { background: accent, color: foreground }
  if (variant === "outline") return { color: accent, borderColor: accent }
  return { color: accent }
}

// Separate from HeaderPillVariant: a dropdown's floating panel isn't a button, "outline"/"ghost"
// don't mean anything for a surface that always needs to read as a panel. It defaults to
// --site-surface/--site-text rather than the admin app's --popover/--popover-foreground tokens,
// which the public site never defines (that's why an un-styled dropdown looked unstyled).
export type MenuContentBackground = "light" | "primary"

export const MENU_CONTENT_BACKGROUND_OPTIONS = [
  { label: "Clair",             value: "light" },
  { label: "Couleur principale", value: "primary" },
]

export function menuContentStyle(background: MenuContentBackground, primaryColor: string): CSSProperties {
  return background === "primary"
    ? { background: primaryColor, color: "var(--site-primary-foreground)" }
    : { background: "var(--site-surface, #ffffff)", color: "var(--site-text, #111827)" }
}

// Items are a <DropdownMenuItem>'s default className; merge this in afterwards (twMerge) to
// replace its focus:bg-accent/focus:text-accent-foreground — same admin-tokens problem as the
// panel itself — with a tint of whatever text color menuContentStyle gave the panel.
export const MENU_ITEM_CLASSNAME = "focus:bg-[color-mix(in_srgb,currentColor_12%,transparent)] focus:text-current"
