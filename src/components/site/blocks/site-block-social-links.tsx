import type { ComponentConfig } from "@puckeditor/core"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection,
  type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import {
  SiteSocialIcons, socialLinksField, visibleSocialLinks, type SocialLink,
} from "@/components/site/site-social-icons"

// "Réseaux sociaux": a row of framed icons. The icons, network list and link field are shared
// with the navbar and footer (src/components/site/site-social-icons.tsx).

export type { SocialLink, SocialNetwork } from "@/components/site/site-social-icons"
export type SocialLinksAlign = "left" | "center" | "right"

export type SocialLinksBlockProps = SectionStyleProps & {
  links: SocialLink[]
  align: SocialLinksAlign
}

const ALIGN_CLASSES: Record<SocialLinksAlign, string> = {
  left:   "justify-start",
  center: "justify-center",
  right:  "justify-end",
}

export const socialLinksBlock: ComponentConfig<SocialLinksBlockProps> = {
  label: "Réseaux sociaux",
  fields: {
    links: socialLinksField("Liens"),
    align: {
      type:    "radio",
      label:   "Alignement",
      options: [
        { label: "Gauche", value: "left" },
        { label: "Centre", value: "center" },
        { label: "Droite", value: "right" },
      ],
    },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    links: [
      { network: "facebook",  url: "" },
      { network: "instagram", url: "" },
    ],
    align: "center",
    ...SECTION_STYLE_DEFAULTS,
    spacing: "compact",
  },
  render: ({ links, align, background, spacing, width, puck }) => {
    const hasVisibleLinks = visibleSocialLinks(links).length > 0

    if (!hasVisibleLinks && !puck.isEditing) return <></>

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        {hasVisibleLinks ? (
          <SiteSocialIcons socialLinks={links} variant="framed" className={ALIGN_CLASSES[align]} />
        ) : (
          <div
            className="px-4 py-6 text-center text-sm"
            style={{ background: "var(--site-surface-muted)", color: "var(--site-text-muted)", borderRadius: "var(--site-radius)" }}
          >
            Ajoutez l&apos;adresse de vos réseaux sociaux dans le panneau de droite.
          </div>
        )}
      </SiteBlockSection>
    )
  },
}
