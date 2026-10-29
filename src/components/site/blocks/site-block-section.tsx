import type { ReactNode } from "react"
import type { Fields } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import { SiteReveal } from "@/components/site/site-animations"

// The outer shell every full-width block renders in: background, vertical spacing, content
// width. Blocks spread SECTION_STYLE_FIELDS into their fields and SECTION_STYLE_DEFAULTS into
// their defaultProps, then wrap their content in <SiteBlockSection {...styleProps}>.

export type SectionBackground = "none" | "muted" | "primary" | "secondary"
export type SectionSpacing    = "compact" | "normal" | "large"
export type SectionWidth      = "narrow" | "normal" | "wide"
// "auto" keeps the colour that goes with the background; "light"/"dark" force it.
export type SectionTextColor  = "auto" | "light" | "dark"

export type SectionStyleProps = {
  background: SectionBackground
  // Optional: blocks saved before this option store no value and render as "auto".
  textColor?: SectionTextColor
  spacing:    SectionSpacing
  width:      SectionWidth
}

export const SECTION_STYLE_DEFAULTS: Required<SectionStyleProps> = {
  background: "none",
  textColor:  "auto",
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
  textColor: {
    type:    "radio",
    label:   "Couleur du texte",
    options: [
      { label: "Automatique", value: "auto" },
      { label: "Blanc",       value: "light" },
      { label: "Foncé",       value: "dark" },
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

const TEXT_COLOR_OVERRIDES: Record<SectionTextColor, string | undefined> = {
  auto:  undefined,
  light: "#ffffff",
  dark:  "var(--site-text)",
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

// True when the author forced the text colour: the grey tokens were picked for the background's
// own text colour and would clash with a forced one.
function isExplicitTextColor(textColor: SectionTextColor | undefined): boolean {
  return textColor === "light" || textColor === "dark"
}

// Rich text (RichTextView) inside a section. The typography plugin paints prose with its own
// colour variables (redefined unlayered in globals.css), so on a coloured section the body
// stayed dark grey. These point every variable at the section's text colour; `!` is needed to
// beat that unlayered .prose rule. Arbitrary properties: typography has no "inherit" variant.
export const SITE_RICH_TEXT_CLASSNAME = cn(
  "[--tw-prose-body:currentColor]! [--tw-prose-headings:currentColor]! [--tw-prose-lead:currentColor]!",
  "[--tw-prose-bold:currentColor]! [--tw-prose-links:currentColor]! [--tw-prose-quotes:currentColor]!",
  "[--tw-prose-counters:currentColor]! [--tw-prose-bullets:currentColor]!",
  "[--tw-prose-quote-borders:color-mix(in_srgb,currentColor_25%,transparent)]!",
  "[--tw-prose-hr:color-mix(in_srgb,currentColor_25%,transparent)]!",
  "[--tw-prose-th-borders:color-mix(in_srgb,currentColor_25%,transparent)]!",
  "[--tw-prose-td-borders:color-mix(in_srgb,currentColor_25%,transparent)]!",
)

type SiteBlockSectionProps = Partial<SectionStyleProps> & {
  children:   ReactNode
  className?: string
  id?:        string
}

export function SiteBlockSection({
  background = "none", textColor = "auto", spacing = "normal", width = "normal", children, className, id,
}: SiteBlockSectionProps) {
  const textColorOverride = TEXT_COLOR_OVERRIDES[textColor]
  const sectionStyle      = textColorOverride
    ? { ...BACKGROUND_STYLES[background], color: textColorOverride }
    : BACKGROUND_STYLES[background]
  return (
    <section id={id} className={cn("px-4 sm:px-6 lg:px-8", SPACING_CLASSES[spacing])} style={sectionStyle}>
      <SiteReveal className={cn("mx-auto", WIDTH_CLASSES[width], className)}>{children}</SiteReveal>
    </section>
  )
}

// Muted text that stays readable on every background and forced text colour.
export function mutedTextStyle(background: SectionBackground, textColor?: SectionTextColor): React.CSSProperties {
  return isColoredBackground(background) || isExplicitTextColor(textColor)
    ? { opacity: 0.85 }
    : { color: "var(--site-text-muted)" }
}
