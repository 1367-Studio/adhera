import type { CSSProperties } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { SiteLink } from "@/components/site/blocks/site-block-fields"

// The one button of the public site builder blocks. Colours and corners come from the site
// theme variables, never from the block itself.

export type SiteButtonVariant = "primary" | "secondary" | "outline" | "light"

const BUTTON_STYLES: Record<SiteButtonVariant, CSSProperties> = {
  primary:   { background: "var(--site-primary)", color: "var(--site-primary-foreground)" },
  secondary: { background: "var(--site-secondary)", color: "var(--site-secondary-foreground)" },
  outline:   { border: "1px solid currentColor", background: "transparent" },
  // For coloured or photo backgrounds.
  light:     { background: "#ffffff", color: "var(--site-text)" },
}

export const SITE_BUTTON_VARIANT_OPTIONS = [
  { label: "Principal",  value: "primary" },
  { label: "Secondaire", value: "secondary" },
  { label: "Contour",    value: "outline" },
  { label: "Blanc",      value: "light" },
]

// "/evenements" is relative to the association's site, not to the app: prefix the slug.
// Absolute URLs, mailto:, tel: and anchors are left as they are.
export function resolveSiteHref(href: string, slug: string): string {
  const trimmedHref = href.trim()
  if (!trimmedHref) return "#"
  if (trimmedHref.startsWith("/") && !trimmedHref.startsWith(`/${slug}`)) return `/${slug}${trimmedHref === "/" ? "" : trimmedHref}`
  return trimmedHref
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//.test(href)
}

type SiteButtonProps = {
  link:       SiteLink
  slug:       string
  variant?:   SiteButtonVariant
  className?: string
  /** The href is already a full app path (a form page, /portal/…): do not prefix the slug. */
  isResolvedHref?: boolean
}

// A label is normally a string, but a field edited on the canvas (contentEditable) reaches the
// render as a React element while editing — so never assume string methods are available.
function hasVisibleLabel(label: unknown): boolean {
  if (typeof label === "string") return label.trim() !== ""
  return label !== null && label !== undefined && label !== false
}

export function SiteButton({ link, slug, variant = "primary", className, isResolvedHref = false }: SiteButtonProps) {
  if (!hasVisibleLabel(link.label)) return null
  const href       = isResolvedHref ? link.href : resolveSiteHref(link.href, slug)
  const buttonClass = cn(
    "inline-flex h-11 items-center justify-center px-6 text-sm font-medium transition-opacity hover:opacity-90",
    className,
  )
  const buttonStyle: CSSProperties = { ...BUTTON_STYLES[variant], borderRadius: "var(--site-radius)" }

  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass} style={buttonStyle}>
        {link.label}
      </a>
    )
  }
  return <Link href={href} className={buttonClass} style={buttonStyle}>{link.label}</Link>
}
