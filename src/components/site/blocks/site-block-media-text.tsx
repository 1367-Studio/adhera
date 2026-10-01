import type { ReactNode } from "react"
import type { ComponentConfig } from "@puckeditor/core"
import { imageField } from "@/components/site/blocks/site-block-fields"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import {
  SiteBlockSection, SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, mutedTextStyle, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { SiteButtonGroup, siteButtonsField, type SiteBlockButton } from "@/components/site/blocks/site-block-button-group"
import {
  SiteMediaSplit, type MediaSplitImageAspect, type MediaSplitImagePosition,
} from "@/components/site/blocks/site-block-media-split"

export type MediaTextImagePosition = MediaSplitImagePosition
export type MediaTextImageAspect   = MediaSplitImageAspect

export type MediaTextBlockProps = SectionStyleProps & {
  image:         string
  imageAlt:      string
  imagePosition: MediaTextImagePosition
  imageAspect:   MediaTextImageAspect
  title:         string
  body:          ReactNode
  buttons:       SiteBlockButton[]
}

export const mediaTextBlock: ComponentConfig<MediaTextBlockProps> = {
  label: "Texte et image",
  fields: {
    image:         imageField("Image"),
    imageAlt:      { type: "text", label: "Description de l'image (accessibilité)" },
    imagePosition: {
      type:    "radio",
      label:   "Position de l'image",
      options: [{ label: "À gauche", value: "left" }, { label: "À droite", value: "right" }],
    },
    imageAspect: {
      type:    "radio",
      label:   "Format de l'image",
      options: [
        { label: "4:3", value: "landscape" },
        { label: "1:1", value: "square" },
        { label: "3:4", value: "portrait" },
      ],
    },
    title:   { type: "text", label: "Titre", contentEditable: true },
    body:    { type: "richtext", label: "Texte", contentEditable: true },
    buttons: siteButtonsField(2),
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    image:         "",
    imageAlt:      "",
    imagePosition: "left",
    imageAspect:   "landscape",
    title:         "Notre histoire",
    body:          "<p>Née de l'initiative de quelques parents en 2005, notre association accompagne aujourd'hui plus de 200 familles à travers des ateliers, des sorties et des temps de rencontre.</p><p>Chaque année, une trentaine de bénévoles donnent de leur temps pour faire vivre ces projets.</p>",
    buttons:       [{ label: "Découvrir nos actions", href: "/evenements", variant: "primary" }],
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ image, imageAlt, imagePosition, imageAspect, title, body, buttons, background, spacing, width, puck }) => {
    const { slug } = readSiteMetadata(puck.metadata)

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        <SiteMediaSplit
          image={image}
          imageAlt={imageAlt}
          imagePosition={imagePosition}
          imageAspect={imageAspect}
          isEditing={puck.isEditing}
        >
            {title && <h2 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>}
            {body && (
              <div
                className="text-base leading-relaxed sm:text-lg [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&>*+*]:mt-4"
                style={mutedTextStyle(background)}
              >
                {body}
              </div>
            )}
            <SiteButtonGroup buttons={buttons} slug={slug} className="pt-2" />
        </SiteMediaSplit>
      </SiteBlockSection>
    )
  },
}
