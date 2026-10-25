import type { ReactNode } from "react"
import type { Fields } from "@puckeditor/core"
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr"
import { RichTextView } from "@/components/ui/rich-text-view"
import { cn } from "@/lib/utils"
import { toHtml } from "@/lib/site-content"
import { imageField } from "@/components/site/blocks/site-block-fields"
import {
  SITE_BUTTON_STYLE_OPTIONS, SiteButton, type SiteButtonStyle, type SiteButtonVariant,
} from "@/components/site/blocks/site-block-button"
import {
  SECTION_STYLE_DEFAULTS, SITE_RICH_TEXT_CLASSNAME, SiteBlockSection, isColoredBackground, mutedTextStyle,
  type SectionBackground, type SectionStyleProps, type SectionTextColor,
} from "@/components/site/blocks/site-block-section"
import { SiteMediaSplit } from "@/components/site/blocks/site-block-media-split"
import { OPTIONAL_SECTION_STYLE_FIELDS } from "@/components/site/blocks/site-block-listing"

// Image layouts of the Adhésion and Dons blocks: the same 50/50 split as "Texte et image",
// with the call to action still pointing at the membership / donation form bound to the
// block. "centered" is SiteFormCtaCentered. Both take the section style props (background,
// spacing, width); existing blocks store none of them, so they are optional everywhere.

export type FormCtaLayout = "centered" | "imageLeft" | "imageRight"

export type FormCtaLayoutProps = {
  layout?:   FormCtaLayout
  image?:    string
  imageAlt?: string
}

export const FORM_CTA_LAYOUT_FIELDS: Fields<FormCtaLayoutProps> = {
  layout: {
    type:    "radio",
    label:   "Disposition",
    options: [
      { label: "Centrée",          value: "centered" },
      { label: "Image à gauche",   value: "imageLeft" },
      { label: "Image à droite",   value: "imageRight" },
    ],
  },
  image:    imageField<string | undefined>("Image (dispositions avec image)"),
  imageAlt: { type: "text", label: "Description de l'image (accessibilité)" },
}

// "auto" picks the button style from the section background (formCtaButtonVariant).
export type FormCtaButtonVariant = "auto" | SiteButtonStyle

// Everything the Adhésion and Dons blocks add next to their own fields (title, body…).
export type FormCtaStyleProps = FormCtaLayoutProps & Partial<SectionStyleProps> & {
  buttonVariant?: FormCtaButtonVariant
}

export const FORM_CTA_STYLE_FIELDS: Fields<FormCtaStyleProps> = {
  ...FORM_CTA_LAYOUT_FIELDS,
  ...OPTIONAL_SECTION_STYLE_FIELDS,
  buttonVariant: {
    type:    "radio",
    label:   "Style du bouton",
    options: [{ label: "Automatique", value: "auto" }, ...SITE_BUTTON_STYLE_OPTIONS],
  },
}

export const FORM_CTA_STYLE_DEFAULTS: Required<FormCtaStyleProps> = {
  layout:        "centered",
  image:         "",
  imageAlt:      "",
  buttonVariant: "auto",
  ...SECTION_STYLE_DEFAULTS,
}

// Primary on a primary section (or secondary on a secondary one) would vanish: the button
// turns white on coloured sections. An explicit choice from the block always wins.
function formCtaButtonVariant(background: SectionBackground, buttonVariant: FormCtaButtonVariant): SiteButtonVariant {
  if (buttonVariant !== "auto") return buttonVariant
  return isColoredBackground(background) ? "light" : "primary"
}

type FormCtaNoteProps = {
  note:       string
  background: SectionBackground
  textColor:  SectionTextColor
  isCentered: boolean
}

function FormCtaNote({ note, background, textColor, isCentered }: FormCtaNoteProps) {
  return (
    <p className={`flex items-center gap-1.5 text-xs ${isCentered ? "justify-center" : ""}`} style={mutedTextStyle(background, textColor)}>
      <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {note}
    </p>
  )
}

type FormCtaContentProps = Partial<SectionStyleProps> & {
  title:       string
  body:        string | undefined
  buttonLabel: string
  /** Full app path of the form page — never prefixed again. */
  href:        string
  slug:        string
  /** Small reassurance line under the button (tax receipt for donations). */
  note?:       string
  /** Anchor of the section (the membership block keeps the historical #adhesion). */
  id?:         string
  buttonVariant?: FormCtaButtonVariant
}

type SiteFormCtaSplitProps = FormCtaContentProps & {
  layout:    Exclude<FormCtaLayout, "centered">
  image:     string | undefined
  imageAlt:  string | undefined
  isEditing: boolean
}

export function SiteFormCtaSplit({
  layout, image, imageAlt, title, body, buttonLabel, href, slug, isEditing, note, id,
  background = "none", textColor = "auto", spacing = "normal", width = "normal", buttonVariant = "auto",
}: SiteFormCtaSplitProps) {
  return (
    <SiteBlockSection id={id} background={background} textColor={textColor} spacing={spacing} width={width}>
      <SiteMediaSplit
        image={image}
        imageAlt={imageAlt}
        imagePosition={layout === "imageRight" ? "right" : "left"}
        isEditing={isEditing}
      >
        <h2 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>
        {body && (
          <RichTextView content={toHtml(body)} className={cn(SITE_RICH_TEXT_CLASSNAME, "text-base leading-relaxed sm:text-lg")} />
        )}
        <div className="flex flex-col items-start gap-3 pt-2">
          <SiteButton
            link={{ label: buttonLabel, href }}
            slug={slug}
            variant={formCtaButtonVariant(background, buttonVariant)}
            isResolvedHref
          />
          {note && <FormCtaNote note={note} background={background} textColor={textColor} isCentered={false} />}
        </div>
      </SiteMediaSplit>
    </SiteBlockSection>
  )
}

type SiteFormCtaCenteredProps = FormCtaContentProps & {
  /** Decorative icon above the title, e.g. <HandshakeIcon className="size-10" />. */
  icon?: ReactNode
}

export function SiteFormCtaCentered({
  title, body, buttonLabel, href, slug, note, id, icon,
  background = "none", textColor = "auto", spacing = "normal", width = "normal", buttonVariant = "auto",
}: SiteFormCtaCenteredProps) {
  return (
    <SiteBlockSection id={id} background={background} textColor={textColor} spacing={spacing} width={width}>
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
        {icon && (
          <span
            aria-hidden="true"
            className="flex"
            style={isColoredBackground(background) ? undefined : { color: "var(--site-primary)" }}
          >
            {icon}
          </span>
        )}
        <h2 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>
        {body && (
          <RichTextView content={toHtml(body)} className={cn(SITE_RICH_TEXT_CLASSNAME, "text-base leading-relaxed sm:text-lg")} />
        )}
        <div className="flex w-full flex-col items-center gap-3 pt-2">
          <SiteButton
            link={{ label: buttonLabel, href }}
            slug={slug}
            variant={formCtaButtonVariant(background, buttonVariant)}
            className="w-full sm:w-auto sm:min-w-64"
            isResolvedHref
          />
          {note && <FormCtaNote note={note} background={background} textColor={textColor} isCentered />}
        </div>
      </div>
    </SiteBlockSection>
  )
}
