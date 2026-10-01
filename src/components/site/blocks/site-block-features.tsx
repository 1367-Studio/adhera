import type { CSSProperties } from "react"
import type { ComponentConfig } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import {
  SiteBlockSection, SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, isColoredBackground, mutedTextStyle, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"

export type FeatureItem    = { title: string; text: string }
export type FeatureColumns = "2" | "3"
export type FeatureStyle   = "card" | "plain"

export type FeaturesBlockProps = SectionStyleProps & {
  title:     string
  intro:     string
  items:     FeatureItem[]
  columns:   FeatureColumns
  itemStyle: FeatureStyle
}

const COLUMN_CLASSES: Record<FeatureColumns, string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
}

export const featuresBlock: ComponentConfig<FeaturesBlockProps> = {
  label: "Points forts",
  fields: {
    title: { type: "text", label: "Titre", contentEditable: true },
    intro: { type: "textarea", label: "Introduction (facultatif)", contentEditable: true },
    items: {
      type:  "array",
      label: "Points forts",
      max:   6,
      arrayFields: {
        title: { type: "text", label: "Titre" },
        text:  { type: "textarea", label: "Texte" },
      },
      defaultItemProps: { title: "Nouveau point fort", text: "Décrivez-le en une ou deux phrases." },
      getItemSummary:   featureItem => featureItem.title || "Point fort",
    },
    columns: {
      type:    "radio",
      label:   "Colonnes",
      options: [{ label: "2", value: "2" }, { label: "3", value: "3" }],
    },
    itemStyle: {
      type:    "radio",
      label:   "Présentation",
      options: [{ label: "Encadré", value: "card" }, { label: "Simple", value: "plain" }],
    },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:     "Pourquoi nous rejoindre ?",
    intro:     "",
    items: [
      { title: "Des activités toute l'année", text: "Ateliers hebdomadaires, sorties et événements pour tous les âges." },
      { title: "Une équipe bénévole engagée", text: "Une trentaine de bénévoles vous accueillent et vous accompagnent." },
      { title: "Une cotisation accessible",   text: "Un tarif solidaire pour que chacun puisse participer." },
    ],
    columns:   "3",
    itemStyle: "card",
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, intro, items, columns, itemStyle, background, spacing, width }) => {
    const isCard = itemStyle === "card"
    // On a coloured section the card border follows the text colour instead of the grey token.
    const cardStyle: CSSProperties = {
      border:       isColoredBackground(background) ? "1px solid color-mix(in srgb, currentColor 25%, transparent)" : "1px solid var(--site-border)",
      borderRadius: "var(--site-radius)",
    }

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        {(title || intro) && (
          <div className="mb-10 flex max-w-2xl flex-col gap-3">
            {title && <h2 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>}
            {intro && <p className="text-base leading-relaxed text-pretty sm:text-lg" style={mutedTextStyle(background)}>{intro}</p>}
          </div>
        )}
        <div className={cn("grid gap-6", isCard ? "" : "gap-y-10", COLUMN_CLASSES[columns] ?? COLUMN_CLASSES["3"])}>
          {(items ?? []).map((featureItem, itemIndex) => (
            <div key={`${featureItem.title}-${itemIndex}`} className={cn("flex flex-col gap-2", isCard && "p-6")} style={isCard ? cardStyle : undefined}>
              {featureItem.title && <h3 className="text-lg leading-snug font-semibold">{featureItem.title}</h3>}
              {featureItem.text && <p className="leading-relaxed" style={mutedTextStyle(background)}>{featureItem.text}</p>}
            </div>
          ))}
        </div>
      </SiteBlockSection>
    )
  },
}
