import type { ComponentConfig, Slot } from "@puckeditor/core"
import {
  SiteBlockSection, SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"

// "Section": a free container. Volunteers drop primitive blocks (titles, texts, images,
// columns…) into its slot; the section only brings the background, spacing and width.

export type SectionBlockProps = SectionStyleProps & {
  content: Slot
  anchor:  string
}

// "Nos actions" → "nos-actions", usable as "#nos-actions" in a button link.
export function toSectionAnchorId(anchor: string): string | undefined {
  const anchorId = anchor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return anchorId || undefined
}

export const sectionBlock: ComponentConfig<SectionBlockProps> = {
  label:  "Section",
  fields: {
    content: { type: "slot" },
    ...SECTION_STYLE_FIELDS,
    anchor:  { type: "text", label: "Ancre (lien #ancre, facultatif)" },
  },
  defaultProps: {
    ...SECTION_STYLE_DEFAULTS,
    content: [],
    anchor:  "",
  },
  render: ({ content: SectionContent, anchor, background, spacing, width }) => (
    <SiteBlockSection id={toSectionAnchorId(anchor)} background={background} spacing={spacing} width={width}>
      <SectionContent className="flex flex-col gap-6" minEmptyHeight={120} />
    </SiteBlockSection>
  ),
}
