import type { ComponentConfig } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import { imageField } from "@/components/site/blocks/site-block-fields"
import {
  SiteBlockSection, SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, isColoredBackground, mutedTextStyle, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"

export type TestimonialItem   = { quote: string; author: string; role: string; photo: string }
export type TestimonialLayout = "grid" | "list"

export type TestimonialsBlockProps = SectionStyleProps & {
  title:  string
  layout: TestimonialLayout
  items:  TestimonialItem[]
}

type TestimonialAuthorProps = {
  testimonial: TestimonialItem
  background:  SectionStyleProps["background"]
  centered:    boolean
}

function TestimonialAuthor({ testimonial, background, centered }: TestimonialAuthorProps) {
  if (!testimonial.author && !testimonial.role) return null
  return (
    <figcaption className={cn("flex items-center gap-3", centered && "justify-center")}>
      {testimonial.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={testimonial.photo} alt="" className="size-10 shrink-0 rounded-full object-cover" />
      )}
      <div className={cn("flex flex-col text-sm", centered ? "items-center" : "items-start")}>
        {testimonial.author && <span className="font-semibold">{testimonial.author}</span>}
        {testimonial.role && <span style={mutedTextStyle(background)}>{testimonial.role}</span>}
      </div>
    </figcaption>
  )
}

export const testimonialsBlock: ComponentConfig<TestimonialsBlockProps> = {
  label: "Témoignages",
  fields: {
    title:  { type: "text", label: "Titre", contentEditable: true },
    layout: {
      type:    "radio",
      label:   "Disposition",
      options: [
        { label: "Grille", value: "grid" },
        { label: "Liste",  value: "list" },
      ],
    },
    items: {
      type:  "array",
      label: "Témoignages",
      max:   6,
      arrayFields: {
        quote:  { type: "textarea", label: "Citation" },
        author: { type: "text", label: "Nom" },
        role:   { type: "text", label: "Qualité (ex. adhérente depuis 2019)" },
        photo:  imageField("Photo (facultatif)"),
      },
      defaultItemProps: { quote: "Un témoignage à compléter.", author: "Prénom N.", role: "", photo: "" },
      getItemSummary:   testimonial => testimonial.author || "Témoignage",
    },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:  "Ils en parlent",
    layout: "grid",
    items: [
      { quote: "J'ai rejoint l'association pour les ateliers du samedi et j'y ai trouvé une vraie famille. L'accueil est toujours chaleureux.", author: "Claire M.", role: "Adhérente depuis 2019", photo: "" },
      { quote: "Donner quelques heures par mois comme bénévole m'apporte énormément. On voit concrètement l'effet de ce que l'on fait.", author: "Karim B.", role: "Bénévole", photo: "" },
      { quote: "Nos enfants attendent chaque sortie avec impatience. Merci à toute l'équipe pour son énergie.", author: "Sophie et Marc L.", role: "Parents d'adhérents", photo: "" },
    ],
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, layout, items, background, spacing, width }) => {
    const visibleItems = (items ?? []).filter(testimonial => testimonial.quote?.trim())
    const isList       = layout === "list"
    const dividerColor = isColoredBackground(background) ? "color-mix(in srgb, currentColor 25%, transparent)" : "var(--site-border)"

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        {title && (
          <h2 className={cn("mb-10 text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl", isList && "text-center")}>{title}</h2>
        )}
        {isList ? (
          <div className="mx-auto flex max-w-3xl flex-col">
            {visibleItems.map((testimonial, itemIndex) => (
              <figure
                key={`${testimonial.author}-${itemIndex}`}
                className="flex flex-col gap-6 py-10 text-center first:pt-0 last:pb-0"
                style={itemIndex > 0 ? { borderTop: `1px solid ${dividerColor}` } : undefined}
              >
                <blockquote className="text-xl leading-relaxed text-pretty sm:text-2xl">« {testimonial.quote} »</blockquote>
                <TestimonialAuthor testimonial={testimonial} background={background} centered />
              </figure>
            ))}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {visibleItems.map((testimonial, itemIndex) => (
              <figure
                key={`${testimonial.author}-${itemIndex}`}
                className="flex flex-col justify-between gap-6 p-6"
                style={{ border: `1px solid ${dividerColor}`, borderRadius: "var(--site-radius)" }}
              >
                <blockquote className="leading-relaxed">« {testimonial.quote} »</blockquote>
                <TestimonialAuthor testimonial={testimonial} background={background} centered={false} />
              </figure>
            ))}
          </div>
        )}
      </SiteBlockSection>
    )
  },
}
