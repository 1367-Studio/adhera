import type { ComponentConfig } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import {
  SiteBlockSection, SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, isColoredBackground, mutedTextStyle, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"

export type StatItem = { value: string; label: string }

export type StatsBlockProps = SectionStyleProps & {
  title: string
  intro: string
  items: StatItem[]
}

// 2 per row on phones, then as many as there are figures, up to 4.
function gridColumnsClass(itemCount: number): string {
  if (itemCount <= 1) return "grid-cols-1"
  if (itemCount === 2) return "grid-cols-2"
  if (itemCount === 3) return "grid-cols-2 md:grid-cols-3"
  return "grid-cols-2 md:grid-cols-4"
}

export const statsBlock: ComponentConfig<StatsBlockProps> = {
  label: "Chiffres clés",
  fields: {
    title: { type: "text", label: "Titre (facultatif)", contentEditable: true },
    intro: { type: "textarea", label: "Introduction (facultatif)", contentEditable: true },
    items: {
      type:  "array",
      label: "Chiffres",
      max:   6,
      arrayFields: {
        value: { type: "text", label: "Chiffre (ex. 250)" },
        label: { type: "text", label: "Légende" },
      },
      defaultItemProps: { value: "100", label: "Nouvelle légende" },
      getItemSummary:   statItem => [statItem.value, statItem.label].filter(Boolean).join(" · ") || "Chiffre",
    },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title: "L'association en chiffres",
    intro: "",
    items: [
      { value: "250",  label: "adhérents" },
      { value: "35",   label: "bénévoles actifs" },
      { value: "40",   label: "événements par an" },
      { value: "1998", label: "année de création" },
    ],
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, intro, items, background, spacing, width }) => {
    const visibleItems = (items ?? []).filter(statItem => statItem.value?.trim() || statItem.label?.trim())
    const numberColor  = isColoredBackground(background) ? undefined : "var(--site-primary)"

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        {(title || intro) && (
          <div className="mx-auto mb-12 flex max-w-2xl flex-col gap-3 text-center">
            {title && <h2 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>}
            {intro && <p className="text-base leading-relaxed text-pretty sm:text-lg" style={mutedTextStyle(background)}>{intro}</p>}
          </div>
        )}
        <dl className={cn("grid gap-x-6 gap-y-10 text-center", gridColumnsClass(visibleItems.length))}>
          {visibleItems.map((statItem, itemIndex) => (
            <div key={`${statItem.label}-${itemIndex}`} className="flex flex-col-reverse gap-2">
              <dt className="text-sm sm:text-base" style={mutedTextStyle(background)}>{statItem.label}</dt>
              <dd className="text-4xl leading-none font-bold tracking-tight tabular-nums sm:text-5xl" style={{ color: numberColor }}>
                {statItem.value}
              </dd>
            </div>
          ))}
        </dl>
      </SiteBlockSection>
    )
  },
}
