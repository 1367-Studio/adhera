import type { ComponentConfig } from "@puckeditor/core"
import { SITE_LINK_FIELDS } from "@/components/site/blocks/site-block-fields"
import { SiteButton, SITE_BUTTON_VARIANT_OPTIONS, type SiteButtonVariant } from "@/components/site/blocks/site-block-button"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import { cn } from "@/lib/utils"

// "Boutons": up to three call-to-action buttons side by side.

export type ButtonsAlign = "left" | "center"

export type ButtonsBlockItem = {
  label:   string
  href:    string
  variant: SiteButtonVariant
}

export type ButtonsBlockProps = {
  buttons: ButtonsBlockItem[]
  align:   ButtonsAlign
}

export const buttonsBlock: ComponentConfig<ButtonsBlockProps> = {
  label:  "Boutons",
  fields: {
    buttons: {
      type:        "array",
      label:       "Boutons",
      max:         3,
      arrayFields: {
        ...SITE_LINK_FIELDS,
        variant: { type: "select", label: "Style", options: SITE_BUTTON_VARIANT_OPTIONS },
      },
      defaultItemProps: { label: "Nouveau bouton", href: "/", variant: "secondary" },
      getItemSummary:   buttonItem => buttonItem.label || "Bouton",
    },
    align: {
      type:    "radio",
      label:   "Alignement",
      options: [
        { label: "Gauche", value: "left" },
        { label: "Centré", value: "center" },
      ],
    },
  },
  defaultProps: {
    buttons: [{ label: "Nous contacter", href: "/contact", variant: "primary" }],
    align:   "left",
  },
  render: ({ buttons, align, puck }) => {
    const slug           = readSiteMetadata(puck.metadata).slug
    const visibleButtons = (buttons ?? []).filter(buttonItem => buttonItem.label.trim())
    if (visibleButtons.length === 0) {
      return puck.isEditing ? <SiteEditingPlaceholder className="min-h-16 py-4">Ajoutez un bouton dans le panneau de droite.</SiteEditingPlaceholder> : <></>
    }
    return (
      <div className={cn("flex flex-wrap gap-3", align === "center" && "justify-center")}>
        {visibleButtons.map((buttonItem, buttonIndex) => (
          <SiteButton
            key={buttonIndex}
            link={{ label: buttonItem.label, href: buttonItem.href }}
            slug={slug}
            variant={buttonItem.variant}
          />
        ))}
      </div>
    )
  },
}
