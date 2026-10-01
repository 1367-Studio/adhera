import type { CSSProperties, ReactNode } from "react"
import type { ComponentConfig, Fields } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import { imageField } from "@/components/site/blocks/site-block-fields"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import { SiteButtonGroup, siteButtonsField, type SiteBlockButton } from "@/components/site/blocks/site-block-button-group"
import { SiteImagePlaceholder } from "@/components/site/blocks/site-block-image-placeholder"

// The top-of-page banner of the new builder (replaces the old "hero"). The only block that
// renders an h1, and the only full-width block that manages its own background.

export type BannerLayout          = "centered" | "split" | "text"
export type BannerOverlay         = "light" | "medium" | "strong"
export type BannerHeight          = "auto" | "medium" | "full"
export type BannerContentAlign    = "left" | "center" | "right"
export type BannerContentPosition = "top" | "center" | "bottom"
export type BannerContentWidth    = "narrow" | "medium" | "wide"
export type BannerImagePosition   = "right" | "left"
export type BannerSplitRatio      = "even" | "text-wide" | "image-wide"
export type BannerButtonsLayout   = "inline" | "stacked"
export type BannerButtonsSize     = "normal" | "large"
export type BannerTitleSize       = "normal" | "large" | "xlarge"

// Every option added after the first release is optional: banners saved before it exist
// without these props and must render exactly as they did.
export type BannerBlockProps = {
  layout:           BannerLayout
  eyebrow:          string
  title:            string
  subtitle:         string
  image?:           string
  overlay?:         BannerOverlay
  height:           BannerHeight
  contentAlign?:    BannerContentAlign
  contentPosition?: BannerContentPosition
  contentWidth?:    BannerContentWidth
  imagePosition?:   BannerImagePosition
  splitRatio?:      BannerSplitRatio
  titleSize?:       BannerTitleSize
  buttons:          SiteBlockButton[]
  buttonsLayout?:   BannerButtonsLayout
  buttonsSize?:     BannerButtonsSize
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

// Vertical placement of the content inside a banner taller than its content.
const POSITION_CLASSES: Record<BannerContentPosition, string> = {
  top:    "items-start",
  center: "items-center",
  bottom: "items-end",
}

const TEXT_ALIGN_CLASSES: Record<BannerContentAlign, string> = {
  left:   "items-start text-left",
  center: "mx-auto items-center text-center",
  right:  "ml-auto items-end text-right",
}

const BUTTONS_ALIGN_CLASSES: Record<BannerButtonsLayout, Record<BannerContentAlign, string>> = {
  inline:  { left: "justify-start", center: "justify-center", right: "justify-end" },
  stacked: { left: "flex-col items-start", center: "flex-col items-center", right: "flex-col items-end" },
}

const BUTTONS_SIZE_CLASSES: Record<BannerButtonsSize, string> = {
  normal: "",
  large:  "[&_a]:h-12 [&_a]:px-8 [&_a]:text-base",
}

const WIDTH_CLASSES: Record<BannerContentWidth, string> = {
  narrow: "max-w-xl",
  medium: "max-w-3xl",
  wide:   "max-w-5xl",
}

const TITLE_SIZE_CLASSES: Record<BannerTitleSize, string> = {
  normal: "text-3xl sm:text-4xl lg:text-5xl",
  large:  "text-4xl sm:text-5xl lg:text-6xl",
  xlarge: "text-5xl sm:text-6xl lg:text-7xl",
}

// Column templates, written from the left column to the right one.
const SPLIT_COLUMN_CLASSES: Record<"even" | "wide-first" | "wide-second", string> = {
  "even":        "md:grid-cols-2",
  "wide-first":  "md:grid-cols-[3fr_2fr]",
  "wide-second": "md:grid-cols-[2fr_3fr]",
}

function splitColumnsClass(splitRatio: BannerSplitRatio, imagePosition: BannerImagePosition): string {
  if (splitRatio === "even") return SPLIT_COLUMN_CLASSES.even
  const textIsWide     = splitRatio === "text-wide"
  const textIsFirst    = imagePosition === "right"
  const firstIsWide    = textIsWide === textIsFirst
  return firstIsWide ? SPLIT_COLUMN_CLASSES["wide-first"] : SPLIT_COLUMN_CLASSES["wide-second"]
}

type BannerTextProps = {
  eyebrow:      string
  title:        ReactNode
  subtitle:     ReactNode
  contentAlign: BannerContentAlign
  contentWidth: BannerContentWidth
  titleSize:    BannerTitleSize
  children?:    ReactNode
}

function BannerText({ eyebrow, title, subtitle, contentAlign, contentWidth, titleSize, children }: BannerTextProps) {
  return (
    <div className={cn("flex w-full flex-col gap-5", WIDTH_CLASSES[contentWidth] ?? WIDTH_CLASSES.medium, TEXT_ALIGN_CLASSES[contentAlign] ?? TEXT_ALIGN_CLASSES.left)}>
      {eyebrow?.trim() && (
        <p className="text-sm font-medium tracking-wide uppercase" style={{ opacity: 0.85 }}>{eyebrow}</p>
      )}
      <h1 className={cn("leading-tight font-bold tracking-tight text-balance", TITLE_SIZE_CLASSES[titleSize] ?? TITLE_SIZE_CLASSES.large)}>{title}</h1>
      {subtitle && (
        <p className="text-lg leading-relaxed text-pretty sm:text-xl" style={{ opacity: 0.9 }}>{subtitle}</p>
      )}
      {children}
    </div>
  )
}

const BANNER_FIELDS: Fields<BannerBlockProps> = {
  layout: {
    type:    "radio",
    label:   "Disposition",
    options: [
      { label: "Image en fond",  value: "centered" },
      { label: "Texte et image", value: "split" },
      { label: "Texte seul",     value: "text" },
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
  imagePosition: {
    type:    "radio",
    label:   "Position de l'image",
    options: [
      { label: "Image à droite", value: "right" },
      { label: "Image à gauche", value: "left" },
    ],
  },
  splitRatio: {
    type:    "radio",
    label:   "Répartition texte / image",
    options: [
      { label: "50/50",               value: "even" },
      { label: "Texte large (60/40)", value: "text-wide" },
      { label: "Image large (40/60)", value: "image-wide" },
    ],
  },
  height: {
    type:    "radio",
    label:   "Hauteur",
    options: [
      { label: "Automatique", value: "auto" },
      { label: "Moyenne",     value: "medium" },
      { label: "Plein écran", value: "full" },
    ],
  },
  contentAlign: {
    type:    "radio",
    label:   "Alignement du texte",
    options: [
      { label: "Gauche", value: "left" },
      { label: "Centre", value: "center" },
      { label: "Droite", value: "right" },
    ],
  },
  contentPosition: {
    type:    "radio",
    label:   "Position verticale du texte",
    options: [
      { label: "Haut",   value: "top" },
      { label: "Milieu", value: "center" },
      { label: "Bas",    value: "bottom" },
    ],
  },
  contentWidth: {
    type:    "radio",
    label:   "Largeur du texte",
    options: [
      { label: "Étroit", value: "narrow" },
      { label: "Moyen",  value: "medium" },
      { label: "Large",  value: "wide" },
    ],
  },
  titleSize: {
    type:    "radio",
    label:   "Taille du titre",
    options: [
      { label: "Normal",     value: "normal" },
      { label: "Grand",      value: "large" },
      { label: "Très grand", value: "xlarge" },
    ],
  },
  buttons: siteButtonsField(2),
  buttonsLayout: {
    type:    "radio",
    label:   "Disposition des boutons",
    options: [
      { label: "En ligne", value: "inline" },
      { label: "Empilés",  value: "stacked" },
    ],
  },
  buttonsSize: {
    type:    "radio",
    label:   "Taille des boutons",
    options: [
      { label: "Normal", value: "normal" },
      { label: "Grand",  value: "large" },
    ],
  },
}

export const bannerBlock: ComponentConfig<BannerBlockProps> = {
  label:  "Bannière",
  fields: BANNER_FIELDS,
  // Only show the options that change something for the chosen layout and height.
  resolveFields: bannerData => {
    const layout       = bannerData.props.layout ?? "centered"
    const height       = bannerData.props.height ?? "auto"
    const visibleFields: Fields<BannerBlockProps> = { ...BANNER_FIELDS }
    if (layout === "text") delete visibleFields.image
    if (layout !== "centered") delete visibleFields.overlay
    if (layout !== "split") {
      delete visibleFields.imagePosition
      delete visibleFields.splitRatio
    }
    if (height === "auto") delete visibleFields.contentPosition
    return visibleFields
  },
  defaultProps: {
    layout:          "centered",
    eyebrow:         "Association loi 1901",
    title:           "Ensemble, faisons vivre notre quartier",
    subtitle:        "Depuis 1998, nous rassemblons habitants et bénévoles autour d'activités culturelles, sportives et solidaires.",
    image:           "",
    overlay:         "medium",
    height:          "medium",
    contentAlign:    "center",
    contentPosition: "center",
    contentWidth:    "medium",
    imagePosition:   "right",
    splitRatio:      "even",
    titleSize:       "large",
    buttons:         [
      { label: "Nous rejoindre", href: "/adhesion", variant: "light" },
      { label: "Nos activités",  href: "/evenements", variant: "outline" },
    ],
    buttonsLayout:   "inline",
    buttonsSize:     "normal",
  },
  render: ({
    layout, eyebrow, title, subtitle, image, overlay = "medium", height, buttons, puck,
    contentAlign, contentPosition = "center", contentWidth = "medium", imagePosition = "right",
    splitRatio = "even", titleSize = "large", buttonsLayout = "inline", buttonsSize = "normal",
  }) => {
    const { slug }       = readSiteMetadata(puck.metadata)
    const heightClass    = HEIGHT_CLASSES[height] ?? ""
    const positionClass  = POSITION_CLASSES[contentPosition] ?? POSITION_CLASSES.center
    const hasImage       = Boolean(image)
    const isSplit        = layout === "split"
    const resolvedAlign: BannerContentAlign = contentAlign ?? (isSplit ? "left" : "center")
    const buttonsClass   = cn(
      "pt-2",
      (BUTTONS_ALIGN_CLASSES[buttonsLayout] ?? BUTTONS_ALIGN_CLASSES.inline)[resolvedAlign],
      BUTTONS_SIZE_CLASSES[buttonsSize],
    )
    const bannerText = (
      <BannerText
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        contentAlign={resolvedAlign}
        contentWidth={contentWidth}
        titleSize={titleSize}
      >
        <SiteButtonGroup buttons={buttons} slug={slug} className={buttonsClass} />
      </BannerText>
    )

    if (isSplit) {
      const showsImageColumn = hasImage || puck.isEditing
      // The text stays first on mobile; "left" only moves the image from md upward.
      const imageOrderClass  = imagePosition === "left" ? "md:order-first" : ""
      return (
        <section className={cn("flex px-4 py-16 sm:py-20", positionClass, heightClass)} style={{ background: "var(--site-surface)", color: "var(--site-text)" }}>
          <div className={cn("mx-auto grid w-full max-w-7xl items-center gap-10 lg:gap-16", showsImageColumn && splitColumnsClass(splitRatio, imagePosition))}>
            {bannerText}
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className={cn("aspect-[4/3] w-full object-cover", imageOrderClass)} style={{ borderRadius: "var(--site-radius)" }} />
            ) : puck.isEditing ? (
              <SiteImagePlaceholder className={cn("aspect-[4/3] w-full", imageOrderClass)} />
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
    const hintAlignClass = resolvedAlign === "left" ? "text-left" : resolvedAlign === "right" ? "text-right" : "text-center"

    return (
      <section className={cn("relative flex overflow-hidden px-4 py-20 sm:py-28", positionClass, heightClass)} style={sectionStyle}>
        {showsImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0" style={{ background: `rgba(0, 0, 0, ${OVERLAY_OPACITY[overlay] ?? OVERLAY_OPACITY.medium})` }} />
          </>
        )}
        <div className="relative mx-auto w-full max-w-5xl">
          {bannerText}
          {layout === "centered" && !hasImage && puck.isEditing && (
            <p className={cn("mt-8 text-xs", hintAlignClass)} style={{ opacity: 0.7 }}>Ajoutez une image de fond dans le panneau de droite.</p>
          )}
        </div>
      </section>
    )
  },
}
