import type { ReactNode } from "react"
import type { Fields } from "@puckeditor/core"
import { cn } from "@/lib/utils"

// The outer shell every full-width block renders in: background, vertical spacing, content
// width. Blocks spread SECTION_STYLE_FIELDS into their fields and SECTION_STYLE_DEFAULTS into
// their defaultProps, then wrap their content in <SiteBlockSection {...styleProps}>.

export type SectionBackground = "none" | "muted" | "primary" | "secondary"
export type SectionSpacing    = "compact" | "normal" | "large"
export type SectionWidth      = "narrow" | "normal" | "wide"

export type SectionStyleProps = {
  background: SectionBackground
  spacing:    SectionSpacing
  width:      SectionWidth
}

export const SECTION_STYLE_DEFAULTS: SectionStyleProps = {
  background: "none",
  spacing:    "normal",
  width:      "normal",
}

export const SECTION_STYLE_FIELDS: Fields<SectionStyleProps> = {
  background: {
    type:    "select",
    label:   "Fond",
    options: [
      { label: "Aucun",               value: "none" },
      { label: "Gris clair",          value: "muted" },
      { label: "Couleur principale",  value: "primary" },
      { label: "Couleur secondaire",  value: "secondary" },
    ],
  },
  spacing: {
    type:    "radio",
    label:   "Espacement",
    options: [
      { label: "Serré",  value: "compact" },
      { label: "Normal", value: "normal" },
      { label: "Aéré",   value: "large" },
    ],
  },
  width: {
    type:    "radio",
    label:   "Largeur",
    options: [
      { label: "Étroite", value: "narrow" },
      { label: "Normale", value: "normal" },
      { label: "Large",   value: "wide" },
    ],
  },
}

const BACKGROUND_STYLES: Record<SectionBackground, React.CSSProperties> = {
  none:      { background: "var(--site-surface)", color: "var(--site-text)" },
  muted:     { background: "var(--site-surface-muted)", color: "var(--site-text)" },
  primary:   { background: "var(--site-primary)", color: "var(--site-primary-foreground)" },
  secondary: { background: "var(--site-secondary)", color: "var(--site-secondary-foreground)" },
}

const SPACING_CLASSES: Record<SectionSpacing, string> = {
  compact: "py-8",
  normal:  "py-16",
  large:   "py-24",
}

const WIDTH_CLASSES: Record<SectionWidth, string> = {
  narrow: "max-w-3xl",
  normal: "max-w-5xl",
  wide:   "max-w-7xl",
}

// True when the section sits on a coloured background: muted text and borders must then follow
// the section's own text colour instead of the grey tokens.
export function isColoredBackground(background: SectionBackground): boolean {
  return background === "primary" || background === "secondary"
}

type SiteBlockSectionProps = Partial<SectionStyleProps> & {
  children:   ReactNode
  className?: string
  id?:        string
}

export function SiteBlockSection({
  background = "none", spacing = "normal", width = "normal", children, className, id,
}: SiteBlockSectionProps) {
  return (
    <section id={id} className={cn("px-4", SPACING_CLASSES[spacing])} style={BACKGROUND_STYLES[background]}>
      <div className={cn("mx-auto", WIDTH_CLASSES[width], className)}>{children}</div>
    </section>
  )
}

// Muted text that stays readable on every background.
export function mutedTextStyle(background: SectionBackground): React.CSSProperties {
  return isColoredBackground(background) ? { opacity: 0.85 } : { color: "var(--site-text-muted)" }
}
