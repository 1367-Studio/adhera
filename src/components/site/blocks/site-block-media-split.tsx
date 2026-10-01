import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { SiteImagePlaceholder } from "@/components/site/blocks/site-block-image-placeholder"

// The 50/50 image + text layout, shared by "Texte et image" and the image layouts of the
// Adhésion and Dons blocks. Stacks on mobile (image first), side by side from md.

export type MediaSplitImagePosition = "left" | "right"
export type MediaSplitImageAspect   = "landscape" | "square" | "portrait"

const ASPECT_CLASSES: Record<MediaSplitImageAspect, string> = {
  landscape: "aspect-[4/3]",
  square:    "aspect-square",
  portrait:  "aspect-[3/4]",
}

type SiteMediaSplitProps = {
  image:         string | undefined
  imageAlt:      string | undefined
  imagePosition: MediaSplitImagePosition
  imageAspect?:  MediaSplitImageAspect
  isEditing:     boolean
  /** The text column: title, text, buttons. */
  children:      ReactNode
}

export function SiteMediaSplit({
  image, imageAlt, imagePosition, imageAspect = "landscape", isEditing, children,
}: SiteMediaSplitProps) {
  const aspectClass      = ASPECT_CLASSES[imageAspect] ?? ASPECT_CLASSES.landscape
  // Without an image the text takes the full width on the public site; the editor keeps the
  // column so the volunteer sees where the image goes.
  const showsImageColumn = Boolean(image) || isEditing

  return (
    <div className={cn("grid items-center gap-8 md:gap-12", showsImageColumn && "md:grid-cols-2")}>
      {showsImageColumn && (
        <div className={cn(imagePosition === "right" && "md:order-2")}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={imageAlt ?? ""}
              className={cn("w-full object-cover", aspectClass)}
              style={{ borderRadius: "var(--site-radius)" }}
            />
          ) : (
            <SiteImagePlaceholder className={cn("w-full", aspectClass)} />
          )}
        </div>
      )}
      <div className="flex flex-col gap-5">{children}</div>
    </div>
  )
}
