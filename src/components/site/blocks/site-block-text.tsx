import type { ComponentConfig, RichText } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { SiteBlockTextInlineMenu } from "@/components/site/blocks/site-block-text-toolbar"

// "Texte": a rich text paragraph (bold, lists, links…). Puck hands the value as a rendered
// ReactNode both in the editor and in <Render>, so it is placed as is.
//
// Per-paragraph alignment (left/center/right/justify) is Puck's own richtext toolbar control
// (AlignSelect, added below via renderInlineMenu — Puck's default floating menu only ever shows
// Bold/Italic/Underline, so without this the justify/right options exist in the data model but
// are simply unreachable from the UI). `align` below is a separate, older, whole-block
// left/center shortcut kept only so content saved before AlignSelect existed keeps rendering
// the way it was set up; new edits should use the toolbar's alignment control instead.

export type TextAlign = "left" | "center"
export type TextSize  = "small" | "normal" | "large"

export type TextBlockProps = SectionStyleProps & {
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
    content: {
      type:            "richtext",
      label:           "Contenu",
      contentEditable: true,
      // Puck's default floating menu only offers Bold/Italic/Underline; add the alignment
      // control (left/center/right/justify, already fully supported by the stored data — see
      // the extension's defaults — just never exposed) and the AI writing assistant.
      renderInlineMenu: ({ children, editor }) => (
        <SiteBlockTextInlineMenu editor={editor}>{children}</SiteBlockTextInlineMenu>
      ),
    },
    align: {
      type:    "radio",
      // Distinguished from the toolbar's own per-paragraph alignment (which this label could
      // otherwise be mistaken for): this one sets the whole block at once and only goes as far
      // as centering it.
      label:   "Alignement du bloc entier",
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
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    content: "<p>Présentez ici votre association, vos actions ou toute information utile à vos visiteurs.</p>",
    align:   "left",
    size:    "normal",
    ...SECTION_STYLE_DEFAULTS,
    // Body text reads best on a narrower column than the "normal" default most other blocks use.
    width: "narrow",
  },
  render: ({ content, align, size, background, textColor, spacing, width }) => (
    <SiteBlockSection background={background} textColor={textColor} spacing={spacing} width={width}>
      <div className={cn(PROSE_CLASSES, SIZE_CLASSES[size] ?? SIZE_CLASSES.normal, align === "center" && "text-center")}>
        {content}
      </div>
    </SiteBlockSection>
  ),
}
