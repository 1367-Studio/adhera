import type { ArrayField } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import type { SiteLink } from "@/components/site/blocks/site-block-fields"
import { SITE_LINK_FIELDS } from "@/components/site/blocks/site-block-fields"
import { SiteButton, SITE_BUTTON_VARIANT_OPTIONS, type SiteButtonVariant } from "@/components/site/blocks/site-block-button"

// A short list of call-to-action buttons (banner, texte et image, appel à l'action…): one
// Puck array field + one renderer, so every block lays its buttons out the same way.

export type SiteBlockButton = SiteLink & { variant: SiteButtonVariant }

export function siteButtonsField(maxButtons = 2, label = "Boutons"): ArrayField<SiteBlockButton[]> {
  return {
    type:  "array",
    label,
    max:   maxButtons,
    arrayFields: {
      ...SITE_LINK_FIELDS,
      variant: { type: "select", label: "Style", options: SITE_BUTTON_VARIANT_OPTIONS },
    },
    defaultItemProps: { label: "En savoir plus", href: "/", variant: "primary" },
    getItemSummary:   siteButton => siteButton.label || "Bouton",
  }
}

type SiteButtonGroupProps = {
  buttons:    SiteBlockButton[] | undefined
  slug:       string
  className?: string
}

export function SiteButtonGroup({ buttons, slug, className }: SiteButtonGroupProps) {
  // Same guard as SiteButton: a label is not guaranteed to be a string at render time.
  const visibleButtons = (buttons ?? []).filter(siteButton =>
    typeof siteButton.label === "string" ? siteButton.label.trim() !== "" : Boolean(siteButton.label),
  )
  if (visibleButtons.length === 0) return null
  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      {visibleButtons.map((siteButton, buttonIndex) => (
        <SiteButton
          key={`${siteButton.label}-${buttonIndex}`}
          link={{ label: siteButton.label, href: siteButton.href ?? "" }}
          slug={slug}
          variant={siteButton.variant}
        />
      ))}
    </div>
  )
}
