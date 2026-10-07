import type { ComponentConfig } from "@puckeditor/core"
import { PublicSiteLocaleSwitcher } from "@/components/site/public-site-locale-switcher"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import { cn } from "@/lib/utils"

// "Traduction": a globe button a visitor can place anywhere on the page, like the other
// content blocks. Switching it sets the SITE_LOCALE cookie (never NEXT_LOCALE — see the
// comment on SITE_LOCALE_COOKIE) and refreshes; the actual content translation that follows
// is done server-side, in site-puck-translate.ts and site-ui-strings.ts.

export type TranslateAlign = "left" | "center" | "right"

export type TranslateBlockProps = {
  align: TranslateAlign
}

const ALIGN_CLASSES: Record<TranslateAlign, string> = {
  left:   "justify-start",
  center: "justify-center",
  right:  "justify-end",
}

export const translateBlock: ComponentConfig<TranslateBlockProps> = {
  label:  "Traduction",
  fields: {
    align: {
      type:    "radio",
      label:   "Alignement",
      options: [
        { label: "Gauche", value: "left" },
        { label: "Centre", value: "center" },
        { label: "Droite", value: "right" },
      ],
    },
  },
  defaultProps: { align: "left" },
  render: ({ align, puck }) => (
    <div className={cn("flex", ALIGN_CLASSES[align])}>
      <PublicSiteLocaleSwitcher locale={readSiteMetadata(puck.metadata).locale} />
    </div>
  ),
}
