import type { ComponentConfig, Fields } from "@puckeditor/core"
import Link from "next/link"
import { YES_NO_OPTIONS, imageField } from "@/components/site/blocks/site-block-fields"
import { resolveSiteHref, isExternalHref } from "@/components/site/blocks/site-block-button"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import { cn } from "@/lib/utils"

// "Image": one picture with an optional caption, corners from the site theme. Can optionally
// link out (e.g. a poster linking to a PDF, or to another page of the site) — without a link
// set, the image keeps its normal, non-clickable behaviour.

export type ImageAspect = "original" | "16:9" | "4:3" | "1:1"

export type ImageBlockProps = {
  imageUrl:        string
  alt:             string
  caption:         string
  aspect:          ImageAspect
  // Optional: blocks saved before the link option existed have neither key.
  linkUrl?:        string
  linkOpenNewTab?: boolean
}

const ASPECT_CLASSES: Record<ImageAspect, string> = {
  "original": "h-auto",
  "16:9":     "aspect-video object-cover",
  "4:3":      "aspect-4/3 object-cover",
  "1:1":      "aspect-square object-cover",
}

const IMAGE_FIELDS: Fields<ImageBlockProps> = {
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
  linkUrl:        { type: "text", label: "Lien au clic (https://… ou /page, facultatif)" },
  linkOpenNewTab: { type: "radio", label: "Ouvrir le lien dans un nouvel onglet", options: YES_NO_OPTIONS },
}

export const imageBlock: ComponentConfig<ImageBlockProps> = {
  label:  "Image",
  fields: IMAGE_FIELDS,
  // "Ouvrir dans un nouvel onglet" is meaningless with no link set — hide it until there is one.
  resolveFields: imageData => {
    if ((imageData.props.linkUrl ?? "").trim()) return IMAGE_FIELDS
    const visibleFields = { ...IMAGE_FIELDS }
    delete visibleFields.linkOpenNewTab
    return visibleFields
  },
  defaultProps: {
    imageUrl:       "",
    alt:            "",
    caption:        "",
    aspect:         "original",
    linkUrl:        "",
    linkOpenNewTab: false,
  },
  render: ({ imageUrl, alt, caption, aspect, linkUrl = "", linkOpenNewTab = false, puck }) => {
    if (!imageUrl) {
      return puck.isEditing ? <SiteEditingPlaceholder>Choisissez une image dans le panneau de droite.</SiteEditingPlaceholder> : <></>
    }

    const trimmedLinkUrl = linkUrl.trim()
    // An empty "accessibilité" description is fine for a plain picture, but once the image is
    // also a link it needs *some* accessible name — fall back to the caption rather than
    // leaving assistive tech announcing an unlabelled link.
    const imageAlt = alt || (trimmedLinkUrl ? caption : "")

    const imageElement = (
      // eslint-disable-next-line @next/next/no-img-element -- uploaded R2 URLs of any size
      <img
        src={imageUrl}
        alt={imageAlt}
        loading="lazy"
        className={cn("block w-full", ASPECT_CLASSES[aspect] ?? ASPECT_CLASSES.original)}
        style={{ borderRadius: "var(--site-radius)" }}
      />
    )

    const linkedImage = trimmedLinkUrl ? (() => {
      const { slug }      = readSiteMetadata(puck.metadata)
      const resolvedHref  = resolveSiteHref(trimmedLinkUrl, slug)
      const linkClassName = "block transition-opacity hover:opacity-90"
      const newTabProps   = linkOpenNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {}
      return isExternalHref(resolvedHref) ? (
        <a href={resolvedHref} className={linkClassName} {...newTabProps}>{imageElement}</a>
      ) : (
        <Link href={resolvedHref} className={linkClassName} {...newTabProps}>{imageElement}</Link>
      )
    })() : imageElement

    return (
      <figure className="m-0">
        {linkedImage}
        {caption.trim() && (
          <figcaption className="mt-2 text-sm" style={{ color: "var(--site-text-muted)" }}>{caption}</figcaption>
        )}
      </figure>
    )
  },
}
