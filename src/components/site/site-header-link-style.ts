import type { SiteLink } from "@/components/site/blocks/site-block-fields"

// Shared by SiteNavbar (header links, Adhérer) and SiteHeaderAdhesionMenu (dropdown trigger) —
// its own file so the two don't import each other.

export type HeaderPillVariant = "outline" | "ghost"
export type HeaderLinkItem = SiteLink & { variant?: HeaderPillVariant }

export const HEADER_PILL_VARIANT_OPTIONS = [
  { label: "Contour", value: "outline" },
  { label: "Sans bordure", value: "ghost" },
]

// "outline" keeps a border, "ghost" has none — both get the same hover/active treatment, a
// tint of the link's own color (currentColor) rather than a flat opacity fade, so the control
// still reads against busy header backgrounds instead of just going translucent.
export function headerPillClassName(variant: HeaderPillVariant = "outline"): string {
  const base = "text-sm font-medium px-3 py-1.5 rounded-lg transition-colors "
    + "hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)] "
    + "active:bg-[color-mix(in_srgb,currentColor_16%,transparent)]"
  return variant === "outline" ? `${base} border` : base
}
