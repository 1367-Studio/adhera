import type { ComponentConfig } from "@puckeditor/core"
import type { ReactNode } from "react"
import { YES_NO_OPTIONS } from "@/components/site/blocks/site-block-fields"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection, mutedTextStyle,
  type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import { cn } from "@/lib/utils"
import { SiteMapEmbed } from "@/components/site/blocks/site-block-map"

// "Contact": the association's details from Paramètres → Identité (never typed twice), plus
// optional opening hours and an embedded map.

export type ContactBlockProps = SectionStyleProps & {
  title:       string
  intro:       string
  showAddress: boolean
  showPhone:   boolean
  showEmail:   boolean
  hours:       string
  showMap:     boolean
}

const ICON_PATHS = {
  address: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  phone:   <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  email:   <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  hours:   <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
} as const

function ContactIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 size-5 shrink-0 opacity-70"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

function ContactRow({ icon, label, children }: { icon: keyof typeof ICON_PATHS; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <ContactIcon name={icon} />
      <div className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd className="text-base">{children}</dd>
      </div>
    </div>
  )
}

export const contactBlock: ComponentConfig<ContactBlockProps> = {
  label: "Contact",
  fields: {
    title:       { type: "text", label: "Titre", contentEditable: true },
    intro:       { type: "textarea", label: "Introduction", contentEditable: true },
    showAddress: { type: "radio", label: "Afficher l'adresse", options: YES_NO_OPTIONS },
    showPhone:   { type: "radio", label: "Afficher le téléphone", options: YES_NO_OPTIONS },
    showEmail:   { type: "radio", label: "Afficher l'e-mail", options: YES_NO_OPTIONS },
    hours:       { type: "textarea", label: "Horaires / permanences" },
    showMap:     { type: "radio", label: "Afficher la carte", options: YES_NO_OPTIONS },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:       "Nous contacter",
    intro:       "Une question sur nos activités ou l'adhésion ? Écrivez-nous ou passez nous voir lors d'une permanence.",
    showAddress: true,
    showPhone:   true,
    showEmail:   true,
    hours:       "",
    showMap:     true,
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, intro, showAddress, showPhone, showEmail, hours, showMap, background, spacing, width, puck }) => {
    const metadata = readSiteMetadata(puck.metadata)

    // `address` is the legacy composed string (src/lib/address.ts): shown as-is, never parsed.
    const cityLine     = [metadata.city, metadata.city ? metadata.country : null].filter(Boolean).join(", ")
    const addressText  = metadata.address?.trim() || cityLine
    const phoneText    = metadata.phone?.trim() ?? ""
    const emailText    = metadata.contactEmail?.trim() ?? ""
    const hoursText    = hours?.trim() ?? ""
    const mapQuery     = metadata.address?.trim() || metadata.city?.trim() || ""

    const displayAddress = showAddress && Boolean(addressText)
    const displayPhone   = showPhone && Boolean(phoneText)
    const displayEmail   = showEmail && Boolean(emailText)
    const hasDetails     = displayAddress || displayPhone || displayEmail || Boolean(hoursText)
    const displayMap     = showMap && Boolean(mapQuery)
    const hasContactData = Boolean(addressText || phoneText || emailText)

    if (!hasDetails && !displayMap && !puck.isEditing) return <></>

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        <div className={cn("grid gap-10", displayMap && "md:grid-cols-2")}>
          <div>
            {title && <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>}
            {intro && <p className="mt-3 whitespace-pre-line text-base" style={mutedTextStyle(background)}>{intro}</p>}

            {!hasContactData && puck.isEditing && (
              <div
                className="mt-6 px-4 py-6 text-sm"
                style={{ background: "var(--site-surface-muted)", color: "var(--site-text-muted)", borderRadius: "var(--site-radius)" }}
              >
                Renseignez vos coordonnées dans Paramètres → Identité.
              </div>
            )}

            {hasDetails && (
              <dl className="mt-8 space-y-4">
                {displayAddress && (
                  <ContactRow icon="address" label="Adresse">
                    <span className="whitespace-pre-line">{addressText}</span>
                  </ContactRow>
                )}
                {displayPhone && (
                  <ContactRow icon="phone" label="Téléphone">
                    <a href={`tel:${phoneText.replace(/[^\d+]/g, "")}`} className="underline-offset-4 hover:underline">{phoneText}</a>
                  </ContactRow>
                )}
                {displayEmail && (
                  <ContactRow icon="email" label="E-mail">
                    <a href={`mailto:${emailText}`} className="break-all underline-offset-4 hover:underline">{emailText}</a>
                  </ContactRow>
                )}
                {hoursText && (
                  <ContactRow icon="hours" label="Horaires / permanences">
                    <span className="whitespace-pre-line">{hoursText}</span>
                  </ContactRow>
                )}
              </dl>
            )}
          </div>

          {displayMap && (
            // Same OpenStreetMap map as the Carte block. While editing, clicks go to the editor.
            <div className={cn(puck.isEditing && "pointer-events-none")}>
              <SiteMapEmbed address={mapQuery} height="medium" />
            </div>
          )}
        </div>
      </SiteBlockSection>
    )
  },
}
