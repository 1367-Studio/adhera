import type { ComponentConfig } from "@puckeditor/core"
import { YES_NO_OPTIONS, imageField } from "@/components/site/blocks/site-block-fields"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection,
  type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { cn } from "@/lib/utils"

// "Partenaires": a centred grid of logos, optionally greyed until hovered.

export type Partner = { logo: string; name: string; url: string }

export type PartnersBlockProps = SectionStyleProps & {
  title:     string
  partners:  Partner[]
  grayscale: boolean
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//.test(url)
}

export const partnersBlock: ComponentConfig<PartnersBlockProps> = {
  label: "Partenaires",
  fields: {
    title: { type: "text", label: "Titre", contentEditable: true },
    partners: {
      type:             "array",
      label:            "Partenaires",
      max:              24,
      arrayFields: {
        logo: imageField("Logo"),
        name: { type: "text", label: "Nom" },
        url:  { type: "text", label: "Site web (https://…)" },
      },
      defaultItemProps: { logo: "", name: "", url: "" },
      getItemSummary:   partner => partner.name || "Partenaire",
    },
    grayscale: { type: "radio", label: "Logos en noir et blanc", options: YES_NO_OPTIONS },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:     "Nos partenaires",
    partners:  [],
    grayscale: true,
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, partners, grayscale, background, spacing, width, puck }) => {
    const visiblePartners = partners.filter(partner => partner.logo)
    const logoClass = cn(
      "max-h-16 w-auto max-w-full object-contain",
      grayscale && "opacity-80 grayscale transition duration-200 hover:opacity-100 hover:grayscale-0",
    )

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        {title && <h2 className="mb-10 text-center text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>}

        {visiblePartners.length === 0 && puck.isEditing && (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ background: "var(--site-surface-muted)", color: "var(--site-text-muted)", borderRadius: "var(--site-radius)" }}
          >
            Ajoutez les logos de vos partenaires dans le panneau de droite.
          </div>
        )}

        {visiblePartners.length > 0 && (
          <ul className="grid grid-cols-2 items-center gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {visiblePartners.map((partner, partnerIndex) => {
              const partnerUrl = partner.url?.trim()
              // eslint-disable-next-line @next/next/no-img-element
              const logoImage  = <img src={partner.logo} alt={partner.name || "Partenaire"} loading="lazy" className={logoClass} />
              return (
                <li key={partnerIndex} className="flex h-20 items-center justify-center">
                  {partnerUrl ? (
                    <a
                      href={partnerUrl}
                      {...(isExternalUrl(partnerUrl) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="flex h-full items-center justify-center"
                    >
                      {logoImage}
                    </a>
                  ) : logoImage}
                </li>
              )
            })}
          </ul>
        )}
      </SiteBlockSection>
    )
  },
}
