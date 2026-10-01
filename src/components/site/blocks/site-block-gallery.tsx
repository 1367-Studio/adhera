import type { ComponentConfig } from "@puckeditor/core"
import { imageField } from "@/components/site/blocks/site-block-fields"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection, mutedTextStyle,
  type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { cn } from "@/lib/utils"

// "Galerie": a static photo grid. Each photo opens full size in a new tab; no lightbox JS.

export type GalleryImage = { image: string; alt: string; caption: string }
export type GalleryColumns = "2" | "3" | "4"
export type GalleryAspect = "square" | "original"

export type GalleryBlockProps = SectionStyleProps & {
  title:   string
  images:  GalleryImage[]
  columns: GalleryColumns
  aspect:  GalleryAspect
}

const GRID_CLASSES: Record<GalleryColumns, string> = {
  "2": "grid-cols-1 sm:grid-cols-2",
  "3": "grid-cols-2 md:grid-cols-3",
  "4": "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
}

export const galleryBlock: ComponentConfig<GalleryBlockProps> = {
  label: "Galerie",
  fields: {
    title: { type: "text", label: "Titre", contentEditable: true },
    images: {
      type:             "array",
      label:            "Photos",
      max:              30,
      arrayFields: {
        image:   imageField("Photo"),
        alt:     { type: "text", label: "Description (accessibilité)" },
        caption: { type: "text", label: "Légende (facultatif)" },
      },
      defaultItemProps: { image: "", alt: "", caption: "" },
      getItemSummary:   (galleryImage, imageIndex) =>
        galleryImage.caption || galleryImage.alt || `Photo ${(imageIndex ?? 0) + 1}`,
    },
    columns: {
      type:    "radio",
      label:   "Colonnes",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    aspect: {
      type:    "radio",
      label:   "Format",
      options: [
        { label: "Carré",    value: "square" },
        { label: "Original", value: "original" },
      ],
    },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:   "En images",
    images:  [],
    columns: "3",
    aspect:  "square",
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, images, columns, aspect, background, spacing, width, puck }) => {
    const visibleImages = images.filter(galleryImage => galleryImage.image)
    const isSquare      = aspect === "square"

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        {title && <h2 className="mb-8 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>}

        {visibleImages.length === 0 && puck.isEditing && (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ background: "var(--site-surface-muted)", color: "var(--site-text-muted)", borderRadius: "var(--site-radius)" }}
          >
            Ajoutez des photos dans le panneau de droite.
          </div>
        )}

        {visibleImages.length > 0 && (
          <ul className={cn("grid gap-4", GRID_CLASSES[columns], !isSquare && "items-start")}>
            {visibleImages.map((galleryImage, imageIndex) => (
              <li key={imageIndex}>
                <figure>
                  <a
                    href={galleryImage.image}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden"
                    style={{ borderRadius: "var(--site-radius)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={galleryImage.image}
                      alt={galleryImage.alt || galleryImage.caption || ""}
                      loading="lazy"
                      className={cn("w-full transition-opacity hover:opacity-90", isSquare ? "aspect-square object-cover" : "h-auto")}
                    />
                  </a>
                  {galleryImage.caption && (
                    <figcaption className="mt-2 text-sm" style={mutedTextStyle(background)}>{galleryImage.caption}</figcaption>
                  )}
                </figure>
              </li>
            ))}
          </ul>
        )}
      </SiteBlockSection>
    )
  },
}
