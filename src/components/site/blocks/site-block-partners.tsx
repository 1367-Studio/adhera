import type { ComponentConfig, Fields } from "@puckeditor/core"
import { YES_NO_OPTIONS, imageField } from "@/components/site/blocks/site-block-fields"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection,
  type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { cn } from "@/lib/utils"

// "Partenaires": a centred grid of logos, optionally greyed until hovered, or a scrolling
// logo band ("Défilement") animated in pure CSS.

export type Partner = { logo: string; name: string; url: string }

export type PartnersDisplay   = "grid" | "marquee"
export type MarqueeSpeed      = "slow" | "normal" | "fast"
export type MarqueeDirection  = "left" | "right"

export type PartnersBlockProps = SectionStyleProps & {
  title:      string
  partners:   Partner[]
  grayscale:  boolean
  // Optional: blocks saved before the scrolling band existed have none of these.
  display?:   PartnersDisplay
  speed?:     MarqueeSpeed
  direction?: MarqueeDirection
}

// Seconds per loop for a copy of MARQUEE_MIN_ITEMS logos; longer copies scroll proportionally
// longer so the logos keep the same apparent speed.
const MARQUEE_LOOP_SECONDS: Record<MarqueeSpeed, number> = {
  slow:   60,
  normal: 40,
  fast:   25,
}

// Each copy of the band holds at least this many logos, so a short list still fills the width.
const MARQUEE_MIN_ITEMS = 8

const MARQUEE_CLASS = "site-partners-marquee"

// Scoped styles of the band (globals.css stays untouched). The track holds two identical copies
// and slides by -50%, which lands exactly on the start of the second copy: a seamless loop.
const MARQUEE_STYLES = `
@keyframes ${MARQUEE_CLASS}-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.${MARQUEE_CLASS} {
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
}
.${MARQUEE_CLASS}-track {
  display: flex;
  width: max-content;
  animation: ${MARQUEE_CLASS}-scroll var(--${MARQUEE_CLASS}-duration, 40s) linear infinite;
  animation-direction: var(--${MARQUEE_CLASS}-direction, normal);
}
.${MARQUEE_CLASS}:hover .${MARQUEE_CLASS}-track,
.${MARQUEE_CLASS}:focus-within .${MARQUEE_CLASS}-track {
  animation-play-state: paused;
}
.${MARQUEE_CLASS}-copy {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 3rem;
  padding-right: 3rem;
}
@media (prefers-reduced-motion: reduce) {
  .${MARQUEE_CLASS} { -webkit-mask-image: none; mask-image: none; }
  .${MARQUEE_CLASS}-track { width: auto; animation: none; justify-content: center; }
  .${MARQUEE_CLASS}-copy { flex-wrap: wrap; justify-content: center; row-gap: 2.5rem; padding-right: 0; }
  .${MARQUEE_CLASS}-repeat,
  .${MARQUEE_CLASS}-copy[aria-hidden="true"] { display: none; }
}
`

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//.test(url)
}

const PARTNERS_FIELDS: Fields<PartnersBlockProps> = {
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
  display: {
    type:    "radio",
    label:   "Affichage",
    options: [
      { label: "Grille",     value: "grid" },
      { label: "Défilement", value: "marquee" },
    ],
  },
  speed: {
    type:    "radio",
    label:   "Vitesse",
    options: [
      { label: "Lent",   value: "slow" },
      { label: "Normal", value: "normal" },
      { label: "Rapide", value: "fast" },
    ],
  },
  direction: {
    type:    "radio",
    label:   "Sens",
    options: [
      { label: "Vers la gauche", value: "left" },
      { label: "Vers la droite", value: "right" },
    ],
  },
  grayscale: { type: "radio", label: "Logos en noir et blanc", options: YES_NO_OPTIONS },
  ...SECTION_STYLE_FIELDS,
}

type PartnerItemOptions = {
  logoClass:    string
  isDecorative: boolean
  className?:   string
}

// One logo cell. Decorative cells (duplicates of the scrolling band) are hidden from assistive
// technologies and skipped by keyboard navigation.
function renderPartnerItem(partner: Partner, itemKey: string, { logoClass, isDecorative, className }: PartnerItemOptions) {
  const partnerUrl = partner.url?.trim()
  // eslint-disable-next-line @next/next/no-img-element
  const logoImage  = <img src={partner.logo} alt={isDecorative ? "" : partner.name || "Partenaire"} loading="lazy" className={logoClass} />
  return (
    <li key={itemKey} className={cn("flex h-20 items-center justify-center", className)} {...(isDecorative ? { "aria-hidden": true } : {})}>
      {partnerUrl ? (
        <a
          href={partnerUrl}
          {...(isExternalUrl(partnerUrl) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          {...(isDecorative ? { tabIndex: -1 } : {})}
          className="flex h-full items-center justify-center"
        >
          {logoImage}
        </a>
      ) : logoImage}
    </li>
  )
}

export const partnersBlock: ComponentConfig<PartnersBlockProps> = {
  label: "Partenaires",
  fields: PARTNERS_FIELDS,
  // Speed and direction only matter for the scrolling band.
  resolveFields: partnersData => {
    const visibleFields: Fields<PartnersBlockProps> = { ...PARTNERS_FIELDS }
    if ((partnersData.props.display ?? "grid") !== "marquee") {
      delete visibleFields.speed
      delete visibleFields.direction
    }
    return visibleFields
  },
  defaultProps: {
    title:     "Nos partenaires",
    partners:  [],
    grayscale: true,
    display:   "grid",
    speed:     "normal",
    direction: "left",
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({
    title, partners, grayscale, display = "grid", speed = "normal", direction = "left",
    background, spacing, width, puck,
  }) => {
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

        {visiblePartners.length > 0 && display === "grid" && (
          <ul className="grid grid-cols-2 items-center gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {visiblePartners.map((partner, partnerIndex) =>
              renderPartnerItem(partner, String(partnerIndex), { logoClass, isDecorative: false }),
            )}
          </ul>
        )}

        {visiblePartners.length > 0 && display === "marquee" && (() => {
          // Repeat the list until a copy holds enough logos to fill the width.
          const repeatCount   = Math.ceil(MARQUEE_MIN_ITEMS / visiblePartners.length)
          const itemsPerCopy  = visiblePartners.length * repeatCount
          const loopSeconds   = Math.round(MARQUEE_LOOP_SECONDS[speed] * itemsPerCopy / MARQUEE_MIN_ITEMS)
          const marqueeLogoClass = cn(logoClass, "max-w-40")
          const trackStyle = {
            [`--${MARQUEE_CLASS}-duration`]:  `${loopSeconds}s`,
            [`--${MARQUEE_CLASS}-direction`]: direction === "right" ? "reverse" : "normal",
          } as React.CSSProperties

          const renderCopy = (copyIndex: number) => (
            <ul
              key={copyIndex}
              className={`${MARQUEE_CLASS}-copy`}
              {...(copyIndex > 0 ? { "aria-hidden": true } : {})}
            >
              {Array.from({ length: repeatCount }, (_unused, repeatIndex) =>
                visiblePartners.map((partner, partnerIndex) => renderPartnerItem(
                  partner,
                  `${repeatIndex}-${partnerIndex}`,
                  {
                    logoClass:    marqueeLogoClass,
                    isDecorative: copyIndex > 0 || repeatIndex > 0,
                    className:    cn("shrink-0", repeatIndex > 0 && `${MARQUEE_CLASS}-repeat`),
                  },
                )),
              )}
            </ul>
          )

          return (
            <div role="region" aria-label="Partenaires" className={MARQUEE_CLASS}>
              <style>{MARQUEE_STYLES}</style>
              <div className={`${MARQUEE_CLASS}-track`} style={trackStyle}>
                {renderCopy(0)}
                {renderCopy(1)}
              </div>
            </div>
          )
        })()}
      </SiteBlockSection>
    )
  },
}
