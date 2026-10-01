import Link from "next/link"
import type { ComponentConfig } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import { YES_NO_OPTIONS } from "@/components/site/blocks/site-block-fields"
import { readSiteMetadata, type SitePuckMetadata } from "@/components/site/blocks/site-block-types"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import {
  SECTION_STYLE_DEFAULTS, SiteBlockSection, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import {
  OPTIONAL_SECTION_STYLE_FIELDS, SiteListingHeader, listingAccentStyle, listingCardStyle, resolveListingLimit,
} from "@/components/site/blocks/site-block-listing"

// "Boutique": a selection of the association's products, read live from puck.metadata.
// Existing sites only store { title, limit }: every other prop is optional and defaulted in
// render. The "see the shop" link was always shown by the original section, so it defaults
// to shown here too.

type SiteProduit = SitePuckMetadata["boutiqueProduits"][number]

export type BoutiqueColumns = "2" | "3" | "4"

export type BoutiqueBlockProps = Partial<SectionStyleProps> & {
  title:          string
  limit:          number
  intro?:         string
  columns?:       BoutiqueColumns
  showPrices?:    boolean
  showAllButton?: boolean
}

const DEFAULT_LIMIT = 6

const COLUMN_CLASSES: Record<BoutiqueColumns, string> = {
  "2": "grid-cols-2",
  "3": "grid-cols-2 lg:grid-cols-3",
  "4": "grid-cols-2 lg:grid-cols-4",
}

function formatCents(amountInCents: number): string {
  return (amountInCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

// Same as the original section: one price when every variant costs the same, else the range.
function produitPriceLabel(produit: SiteProduit): string {
  const variantePrices = produit.variantes.map(variante => variante.price)
  const minimumPrice   = variantePrices.length ? Math.min(...variantePrices) : 0
  const maximumPrice   = variantePrices.length ? Math.max(...variantePrices) : 0
  return minimumPrice === maximumPrice ? formatCents(minimumPrice) : `${formatCents(minimumPrice)} – ${formatCents(maximumPrice)}`
}

export const boutiqueBlock: ComponentConfig<BoutiqueBlockProps> = {
  label: "Boutique",
  fields: {
    title: { type: "text", label: "Titre", contentEditable: true },
    intro: { type: "textarea", label: "Introduction (facultatif)", contentEditable: true },
    limit: { type: "number", label: "Nombre affiché", min: 1, max: 20 },
    columns: {
      type:    "radio",
      label:   "Colonnes",
      options: [{ label: "2", value: "2" }, { label: "3", value: "3" }, { label: "4", value: "4" }],
    },
    showPrices:    { type: "radio", label: "Afficher les prix", options: YES_NO_OPTIONS },
    showAllButton: { type: "radio", label: "Bouton « Voir la boutique »", options: YES_NO_OPTIONS },
    ...OPTIONAL_SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:         "Boutique",
    intro:         "",
    limit:         DEFAULT_LIMIT,
    columns:       "3",
    showPrices:    true,
    showAllButton: true,
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, intro, limit, columns, showPrices, showAllButton, background, spacing, width, puck }) => {
    const metadata          = readSiteMetadata(puck.metadata)
    const sectionBackground = background ?? "none"
    const displayedProduits = (metadata.boutiqueProduits ?? []).slice(0, resolveListingLimit(limit, DEFAULT_LIMIT))
    const withPrices        = showPrices ?? true

    if (displayedProduits.length === 0 && !puck.isEditing) return <></>

    return (
      <SiteBlockSection background={sectionBackground} spacing={spacing} width={width}>
        <SiteListingHeader
          title={title || "Boutique"}
          intro={intro}
          background={sectionBackground}
          showAllLabel={(showAllButton ?? true) ? "Voir la boutique" : undefined}
          showAllHref={`/${metadata.slug}/boutique`}
          slug={metadata.slug}
        />

        {displayedProduits.length === 0 ? (
          <SiteEditingPlaceholder>Aucun produit disponible — ils apparaîtront ici automatiquement.</SiteEditingPlaceholder>
        ) : (
          <div className={cn("grid gap-4 sm:gap-6", COLUMN_CLASSES[columns ?? "3"] ?? COLUMN_CLASSES["3"])}>
            {displayedProduits.map(produit => (
              <Link
                key={produit.id}
                href={`/${metadata.slug}/boutique/${produit.id}`}
                className="group flex flex-col overflow-hidden"
                style={listingCardStyle(sectionBackground)}
              >
                {produit.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={produit.imageUrl} alt={produit.name} loading="lazy" className="aspect-square w-full object-cover" />
                ) : (
                  <div aria-hidden="true" className="aspect-square w-full" style={{ background: "var(--site-surface-muted)" }} />
                )}
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <h3 className="text-base leading-snug font-semibold group-hover:underline">{produit.name}</h3>
                  {withPrices && (
                    <p className="text-sm font-semibold" style={listingAccentStyle(sectionBackground)}>{produitPriceLabel(produit)}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </SiteBlockSection>
    )
  },
}
