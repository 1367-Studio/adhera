import type { ComponentConfig } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import {
  SiteBlockSection, SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, mutedTextStyle, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { SiteButtonGroup, siteButtonsField, type SiteBlockButton } from "@/components/site/blocks/site-block-button-group"

export type CtaBannerLayout = "centered" | "inline"

export type CtaBannerBlockProps = SectionStyleProps & {
  layout:  CtaBannerLayout
  title:   string
  text:    string
  buttons: SiteBlockButton[]
}

export const ctaBannerBlock: ComponentConfig<CtaBannerBlockProps> = {
  label: "Appel à l'action",
  fields: {
    layout: {
      type:    "radio",
      label:   "Disposition",
      options: [
        { label: "Centrée",  value: "centered" },
        { label: "En ligne", value: "inline" },
      ],
    },
    title:   { type: "text", label: "Titre", contentEditable: true },
    text:    { type: "textarea", label: "Texte", contentEditable: true },
    buttons: siteButtonsField(2),
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    layout:  "centered",
    title:   "Rejoignez l'aventure",
    text:    "Adhérez à l'association pour participer à nos activités et soutenir nos projets tout au long de l'année.",
    buttons: [
      { label: "Adhérer",       href: "/adhesion", variant: "light" },
      { label: "Nous contacter", href: "/contact", variant: "outline" },
    ],
    ...SECTION_STYLE_DEFAULTS,
    background: "primary",
  },
  render: ({ layout, title, text, buttons, background, spacing, width, puck }) => {
    const { slug }  = readSiteMetadata(puck.metadata)
    const isInline  = layout === "inline"

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        <div
          className={cn(
            "flex flex-col gap-6",
            isInline ? "md:flex-row md:items-center md:justify-between md:gap-12" : "mx-auto max-w-2xl items-center text-center",
          )}
        >
          <div className="flex flex-col gap-3">
            {title && <h2 className="text-2xl leading-tight font-bold tracking-tight text-balance sm:text-3xl">{title}</h2>}
            {text && <p className="text-base leading-relaxed text-pretty sm:text-lg" style={mutedTextStyle(background)}>{text}</p>}
          </div>
          <SiteButtonGroup buttons={buttons} slug={slug} className={cn(isInline ? "shrink-0" : "justify-center")} />
        </div>
      </SiteBlockSection>
    )
  },
}
