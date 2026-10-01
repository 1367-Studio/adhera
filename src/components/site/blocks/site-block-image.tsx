import type { ComponentConfig } from "@puckeditor/core"
import { imageField } from "@/components/site/blocks/site-block-fields"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import { cn } from "@/lib/utils"

// "Image": one picture with an optional caption, corners from the site theme.

export type ImageAspect = "original" | "16:9" | "4:3" | "1:1"

export type ImageBlockProps = {
  imageUrl: string
  alt:      string
  caption:  string
  aspect:   ImageAspect
}

const ASPECT_CLASSES: Record<ImageAspect, string> = {
  "original": "h-auto",
  "16:9":     "aspect-video object-cover",
  "4:3":      "aspect-4/3 object-cover",
  "1:1":      "aspect-square object-cover",
}

export const imageBlock: ComponentConfig<ImageBlockProps> = {
  label:  "Image",
  fields: {
    imageUrl: imageField("Image"),
    alt:      { type: "text", label: "Description de l'image (accessibilité)" },
    caption:  { type: "text", label: "Légende (facultatif)" },
    aspect: {
      type:    "radio",
      label:   "Format",
      options: [
        { label: "Original", value: "original" },
        { label: "16:9",     value: "16:9" },
        { label: "4:3",      value: "4:3" },
        { label: "Carré",    value: "1:1" },
      ],
    },
  },
  defaultProps: {
    imageUrl: "",
    alt:      "",
    caption:  "",
    aspect:   "original",
  },
  render: ({ imageUrl, alt, caption, aspect, puck }) => {
    if (!imageUrl) {
      return puck.isEditing ? <SiteEditingPlaceholder>Choisissez une image dans le panneau de droite.</SiteEditingPlaceholder> : <></>
    }
    return (
      <figure className="m-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded R2 URLs of any size */}
        <img
          src={imageUrl}
          alt={alt}
          loading="lazy"
          className={cn("block w-full", ASPECT_CLASSES[aspect] ?? ASPECT_CLASSES.original)}
          style={{ borderRadius: "var(--site-radius)" }}
        />
        {caption.trim() && (
          <figcaption className="mt-2 text-sm" style={{ color: "var(--site-text-muted)" }}>{caption}</figcaption>
        )}
      </figure>
    )
  },
}
