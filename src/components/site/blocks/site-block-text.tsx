import type { ComponentConfig, RichText } from "@puckeditor/core"
import { cn } from "@/lib/utils"

// "Texte": a rich text paragraph (bold, lists, links…). Puck hands the value as a rendered
// ReactNode both in the editor and in <Render>, so it is placed as is.

export type TextAlign = "left" | "center"
export type TextSize  = "small" | "normal" | "large"

export type TextBlockProps = {
  content: RichText
  align:   TextAlign
  size:    TextSize
}

const SIZE_CLASSES: Record<TextSize, string> = {
  small:  "text-sm",
  normal: "text-base",
  large:  "text-lg sm:text-xl",
}

// Prose styles written out (no typography plugin): links and lists inherit the section colour.
const PROSE_CLASSES = cn(
  "leading-relaxed text-pretty",
  "[&_p]:my-0 [&_p+p]:mt-4",
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
  "[&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold",
  "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-current [&_blockquote]:pl-4 [&_blockquote]:italic",
)

export const textBlock: ComponentConfig<TextBlockProps> = {
  label:  "Texte",
  fields: {
    content: { type: "richtext", label: "Contenu", contentEditable: true },
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
        { label: "Petite",  value: "small" },
        { label: "Normale", value: "normal" },
        { label: "Grande",  value: "large" },
      ],
    },
  },
  defaultProps: {
    content: "<p>Présentez ici votre association, vos actions ou toute information utile à vos visiteurs.</p>",
    align:   "left",
    size:    "normal",
  },
  render: ({ content, align, size }) => (
    <div className={cn(PROSE_CLASSES, SIZE_CLASSES[size] ?? SIZE_CLASSES.normal, align === "center" && "text-center")}>
      {content}
    </div>
  ),
}
