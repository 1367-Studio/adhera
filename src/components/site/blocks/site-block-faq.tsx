import type { ComponentConfig } from "@puckeditor/core"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection, isColoredBackground, mutedTextStyle,
  type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"

// "Questions fréquentes": native <details>/<summary>, so it opens and closes without any JS.

export type FaqItem = { question: string; answer: string }

export type FaqBlockProps = SectionStyleProps & {
  title: string
  intro: string
  items: FaqItem[]
}

export const faqBlock: ComponentConfig<FaqBlockProps> = {
  label: "Questions fréquentes",
  fields: {
    title: { type: "text", label: "Titre", contentEditable: true },
    intro: { type: "textarea", label: "Introduction", contentEditable: true },
    items: {
      type:             "array",
      label:            "Questions",
      max:              20,
      arrayFields: {
        question: { type: "text", label: "Question" },
        answer:   { type: "textarea", label: "Réponse" },
      },
      defaultItemProps: { question: "Nouvelle question", answer: "" },
      getItemSummary:   faqItem => faqItem.question || "Question",
    },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title: "Questions fréquentes",
    intro: "Vous ne trouvez pas votre réponse ? N'hésitez pas à nous contacter.",
    items: [
      {
        question: "Comment adhérer à l'association ?",
        answer:   "Vous pouvez adhérer directement en ligne depuis la page « Adhérer », ou lors de nos permanences.",
      },
      {
        question: "Quel est le montant de la cotisation ?",
        answer:   "La cotisation annuelle est valable pour la saison en cours. Des tarifs réduits existent pour les étudiants et les demandeurs d'emploi.",
      },
      {
        question: "Puis-je participer à une activité avant d'adhérer ?",
        answer:   "Oui, une séance d'essai gratuite est proposée pour découvrir nos activités.",
      },
    ],
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, intro, items, background, spacing, width, puck }) => {
    const visibleItems = items.filter(faqItem => faqItem.question && String(faqItem.question).trim())
    const separatorColor = isColoredBackground(background)
      ? "color-mix(in srgb, currentColor 25%, transparent)"
      : "var(--site-border)"

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        {(title || intro) && (
          <div className="mb-8 max-w-2xl">
            {title && <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>}
            {intro && <p className="mt-3 whitespace-pre-line text-base" style={mutedTextStyle(background)}>{intro}</p>}
          </div>
        )}

        {visibleItems.length === 0 && puck.isEditing && (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ background: "var(--site-surface-muted)", color: "var(--site-text-muted)", borderRadius: "var(--site-radius)" }}
          >
            Ajoutez des questions dans le panneau de droite.
          </div>
        )}

        {visibleItems.length > 0 && (
          <div className="border-t" style={{ borderColor: separatorColor }}>
            {visibleItems.map((faqItem, itemIndex) => (
              <details key={itemIndex} className="group border-b" style={{ borderColor: separatorColor }}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-medium [&::-webkit-details-marker]:hidden">
                  <span>{faqItem.question}</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-5 shrink-0 transition-transform duration-200 group-open:rotate-180"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                {faqItem.answer && (
                  <p className="whitespace-pre-line pb-5 pr-9 text-sm leading-relaxed sm:text-base" style={mutedTextStyle(background)}>
                    {faqItem.answer}
                  </p>
                )}
              </details>
            ))}
          </div>
        )}
      </SiteBlockSection>
    )
  },
}
