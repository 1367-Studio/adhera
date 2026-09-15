import type { CSSProperties } from "react"
import { isColorDark } from "@/lib/color"
import type { SiteConfig } from "@/types/site-config"

export const SITE_DEFAULT_PRIMARY_COLOR   = "#6366f1"
// Matches the text-gray-900 heading color already hardcoded across every section component,
// so an association that never touches this field sees no visual change.
export const SITE_DEFAULT_SECONDARY_COLOR = "#111827"

// Single source of the CSS custom properties the public site's color palette resolves to —
// set once at the top of the render tree (see [slug]/page.tsx and actualite-detail-view.tsx)
// instead of each section independently repeating `config?.primaryColor ?? "#6366f1"`.
export function getSiteColorVars(config: SiteConfig | null | undefined): CSSProperties {
  const primary   = config?.primaryColor || SITE_DEFAULT_PRIMARY_COLOR
  const secondary = config?.secondaryColor || SITE_DEFAULT_SECONDARY_COLOR

  return {
    "--site-primary":              primary,
    "--site-primary-foreground":   isColorDark(primary) ? "#ffffff" : "#111827",
    "--site-secondary":            secondary,
    "--site-secondary-foreground": isColorDark(secondary) ? "#ffffff" : "#111827",
  } as CSSProperties
}
