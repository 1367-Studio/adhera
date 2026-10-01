import type { ComponentConfig } from "@puckeditor/core"
import { YES_NO_OPTIONS } from "@/components/site/blocks/site-block-fields"
import { cn } from "@/lib/utils"

// "Espace": vertical breathing room between two blocks, optionally with a thin divider line.

export type SpacerSize = "small" | "medium" | "large"

export type SpacerBlockProps = {
  size:        SpacerSize
  showDivider: boolean
}

const SIZE_CLASSES: Record<SpacerSize, string> = {
  small:  "h-4",
  medium: "h-10",
  large:  "h-20",
}

export const spacerBlock: ComponentConfig<SpacerBlockProps> = {
  label:  "Espace",
  fields: {
    size: {
      type:    "radio",
      label:   "Hauteur",
      options: [
        { label: "Petite",  value: "small" },
        { label: "Moyenne", value: "medium" },
        { label: "Grande",  value: "large" },
      ],
    },
    showDivider: { type: "radio", label: "Ligne de séparation", options: YES_NO_OPTIONS },
  },
  defaultProps: {
    size:        "medium",
    showDivider: false,
  },
  render: ({ size, showDivider }) => (
    <div className={cn("flex items-center", SIZE_CLASSES[size] ?? SIZE_CLASSES.medium)} aria-hidden="true">
      {showDivider && <hr className="m-0 h-px w-full border-0" style={{ background: "var(--site-border)" }} />}
    </div>
  ),
}
