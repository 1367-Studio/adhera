import type { CSSProperties, ReactNode } from "react"
import type { ComponentConfig } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import { imageField } from "@/components/site/blocks/site-block-fields"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import { SiteButtonGroup, siteButtonsField, type SiteBlockButton } from "@/components/site/blocks/site-block-button-group"
import { SiteImagePlaceholder } from "@/components/site/blocks/site-block-image-placeholder"

// The top-of-page banner of the new builder (replaces the old "hero"). The only block that
// renders an h1, and the only full-width block that manages its own background.

export type BannerLayout  = "centered" | "split" | "text"
export type BannerOverlay = "light" | "medium" | "strong"
export type BannerHeight  = "auto" | "medium" | "full"

export type BannerBlockProps = {
  layout:   BannerLayout
  eyebrow:  string
  title:    string
  subtitle: string
  image:    string
  overlay:  BannerOverlay
  height:   BannerHeight
  buttons:  SiteBlockButton[]
}

const OVERLAY_OPACITY: Record<BannerOverlay, number> = {
  light:  0.3,
  medium: 0.5,
  strong: 0.7,
}

// "full" leaves room for the site navbar (h-14).
const HEIGHT_CLASSES: Record<BannerHeight, string> = {
  auto:   "",
  medium: "min-h-[60svh]",
  full:   "min-h-[calc(100svh-3.5rem)]",
}

type BannerTextProps = {
  eyebrow:   string
  title:     ReactNode
  subtitle:  ReactNode
  centered:  boolean
  children?: ReactNode
}

function BannerText({ eyebrow, title, subtitle, centered, children }: BannerTextProps) {
  return (
    <div className={cn("flex max-w-3xl flex-col gap-5", centered && "mx-auto items-center text-center")}>
      {eyebrow?.trim() && (
        <p className="text-sm font-medium tracking-wide uppercase" style={{ opacity: 0.85 }}>{eyebrow}</p>
      )}
      <h1 className="text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">{title}</h1>
      {subtitle && (
        <p className="text-lg leading-relaxed text-pretty sm:text-xl" style={{ opacity: 0.9 }}>{subtitle}</p>
      )}
      {children}
    </div>
  )
}

export const bannerBlock: ComponentConfig<BannerBlockProps> = {
  label: "Bannière",
  fields: {
    layout: {
      type:    "radio",
      label:   "Disposition",
      options: [
        { label: "Image en fond", value: "centered" },
        { label: "Texte et image", value: "split" },
        { label: "Texte seul",    value: "text" },
      ],
    },
    eyebrow:  { type: "text", label: "Surtitre (facultatif)" },
    title:    { type: "text", label: "Titre", contentEditable: true },
    subtitle: { type: "textarea", label: "Sous-titre", contentEditable: true },
    image:    imageField("Image"),
    overlay:  {
      type:    "radio",
      label:   "Assombrir l'image",
      options: [
        { label: "Léger", value: "light" },
        { label: "Moyen", value: "medium" },
        { label: "Fort",  value: "strong" },
      ],
    },
    height: {
      type:    "radio",
      label:   "Hauteur",
      options: [
        { label: "Automatique",  value: "auto" },
        { label: "Moyenne",      value: "medium" },
        { label: "Plein écran",  value: "full" },
      ],
    },
    buttons: siteButtonsField(2),
  },
  defaultProps: {
    layout:   "centered",
    eyebrow:  "Association loi 1901",
    title:    "Ensemble, faisons vivre notre quartier",
    subtitle: "Depuis 1998, nous rassemblons habitants et bénévoles autour d'activités culturelles, sportives et solidaires.",
    image:    "",
    overlay:  "medium",
    height:   "medium",
    buttons:  [
      { label: "Nous rejoindre", href: "/adhesion", variant: "light" },
      { label: "Nos activités",  href: "/evenements", variant: "outline" },
    ],
  },
  render: ({ layout, eyebrow, title, subtitle, image, overlay, height, buttons, puck }) => {
    const { slug }    = readSiteMetadata(puck.metadata)
    const heightClass = HEIGHT_CLASSES[height] ?? ""
    const hasImage    = Boolean(image)

    if (layout === "split") {
      return (
        <section className={cn("flex items-center px-4 py-16 sm:py-20", heightClass)} style={{ background: "var(--site-surface)", color: "var(--site-text)" }}>
          <div className={cn("mx-auto grid w-full max-w-7xl items-center gap-10 lg:gap-16", (hasImage || puck.isEditing) && "md:grid-cols-2")}>
            <BannerText eyebrow={eyebrow} title={title} subtitle={subtitle} centered={false}>
              <SiteButtonGroup buttons={buttons} slug={slug} className="pt-2" />
            </BannerText>
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="aspect-[4/3] w-full object-cover" style={{ borderRadius: "var(--site-radius)" }} />
            ) : puck.isEditing ? (
              <SiteImagePlaceholder className="aspect-[4/3] w-full" />
            ) : null}
          </div>
        </section>
      )
    }

    // "centered" without a picture falls back to the plain coloured banner.
    const showsImage = layout === "centered" && hasImage
    const sectionStyle: CSSProperties = showsImage
      ? { color: "#ffffff" }
      : { background: "var(--site-primary)", color: "var(--site-primary-foreground)" }

    return (
      <section className={cn("relative flex items-center overflow-hidden px-4 py-20 sm:py-28", heightClass)} style={sectionStyle}>
        {showsImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0" style={{ background: `rgba(0, 0, 0, ${OVERLAY_OPACITY[overlay] ?? OVERLAY_OPACITY.medium})` }} />
          </>
        )}
        <div className="relative mx-auto w-full max-w-5xl">
          <BannerText eyebrow={eyebrow} title={title} subtitle={subtitle} centered>
            <SiteButtonGroup buttons={buttons} slug={slug} className="justify-center pt-2" />
          </BannerText>
          {layout === "centered" && !hasImage && puck.isEditing && (
            <p className="mt-8 text-center text-xs" style={{ opacity: 0.7 }}>Ajoutez une image de fond dans le panneau de droite.</p>
          )}
        </div>
      </section>
    )
  },
}
