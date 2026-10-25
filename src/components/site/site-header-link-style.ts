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
// The focus ring is the control's own color too: the global outline is the admin blue at 50%,
// invisible on many brand colors.
export function headerPillClassName(variant: HeaderPillVariant = "outline"): string {
  const base = "text-sm font-medium px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
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

export function menuContentStyle(background: MenuContentBackground, primaryColor: string, primaryForeground: string): CSSProperties {
  return background === "primary"
    ? { background: primaryColor, color: primaryForeground }
    : { background: "var(--site-surface, #ffffff)", color: "var(--site-text, #111827)" }
}

// Mobile/tablet header drawer (below lg): on a "primary" drawer background, the filled buttons
// either contrast with it (--site-primary-foreground, which getSiteColorVars already picks to
// stay readable on that primary) or use the brand's secondary color. Ignored on "light".
export type HeaderMenuButtonColor = "contrast" | "secondary"

export const HEADER_MENU_BUTTON_COLOR_OPTIONS = [
  { label: "Automatique (texte lisible)",         value: "contrast" },
  { label: "Couleur secondaire (boutons pleins)", value: "secondary" },
]

// `accent`/`foreground` feed headerPillStyle for one button in the drawer. A light drawer
// always uses the brand primary (white drawer → buttons in the main color); a primary drawer
// can't — primary on primary would vanish. There, outline/ghost buttons always take
// --site-primary-foreground (secondary text on the primary background isn't guaranteed to be
// readable); only filled buttons follow buttonColor, since they bring their own background.
// Plain var() references are fine: the drawer is portaled inside the site chrome div that
// declares them.
export function menuDrawerButtonColors(
  background: MenuContentBackground,
  buttonColor: HeaderMenuButtonColor,
  variant: HeaderPillVariant,
): { accent: string; foreground: string } {
  if (background === "light") return { accent: "var(--site-primary)", foreground: "var(--site-primary-foreground)" }
  if (variant === "primary" && buttonColor === "secondary") {
    return { accent: "var(--site-secondary)", foreground: "var(--site-secondary-foreground)" }
  }
  return { accent: "var(--site-primary-foreground)", foreground: "var(--site-primary)" }
}

// Items are a <DropdownMenuItem>'s default className; merge this in afterwards (twMerge) to
// replace its focus:bg-accent/focus:text-accent-foreground — same admin-tokens problem as the
// panel itself — with a tint of whatever text color menuContentStyle gave the panel.
export const MENU_ITEM_CLASSNAME = "focus:bg-[color-mix(in_srgb,currentColor_12%,transparent)] focus:text-current"
