import type { ComponentConfig } from "@puckeditor/core"
import { cn } from "@/lib/utils"

// "Titre": a section or sub-section heading. The page title belongs to the hero, so only h2/h3.

export type HeadingLevel = "h2" | "h3"
export type HeadingAlign = "left" | "center"
export type HeadingSize  = "normal" | "large"

export type HeadingBlockProps = {
  text:  string
  level: HeadingLevel
  align: HeadingAlign
  size:  HeadingSize
}

const SIZE_CLASSES: Record<HeadingLevel, Record<HeadingSize, string>> = {
  h2: { normal: "text-2xl sm:text-3xl", large: "text-3xl sm:text-4xl lg:text-5xl" },
  h3: { normal: "text-lg sm:text-xl",   large: "text-xl sm:text-2xl" },
}

export const headingBlock: ComponentConfig<HeadingBlockProps> = {
  label:  "Titre",
  fields: {
    text:  { type: "text", label: "Texte", contentEditable: true },
    level: {
      type:    "select",
      label:   "Niveau",
      options: [
        { label: "Titre de section (H2)",      value: "h2" },
        { label: "Sous-titre (H3)",            value: "h3" },
      ],
    },
    align: {
      type:    "radio",
      label:   "Alignement",
      options: [
        { label: "Gauche", value: "left" },
        { label: "Centré", value: "center" },
      ],
    },
    size: {
      type:    "radio",
      label:   "Taille",
      options: [
        { label: "Normale", value: "normal" },
        { label: "Grande",  value: "large" },
      ],
    },
  },
  defaultProps: {
    text:  "Titre de la section",
    level: "h2",
    align: "left",
    size:  "normal",
  },
  render: ({ text, level, align, size }) => {
    const HeadingTag = level === "h3" ? "h3" : "h2"
    return (
      <HeadingTag
        className={cn(
          "font-semibold tracking-tight text-balance",
          SIZE_CLASSES[HeadingTag][size] ?? SIZE_CLASSES[HeadingTag].normal,
          align === "center" && "text-center",
        )}
      >
        {text}
      </HeadingTag>
    )
  },
}
