import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"

// Editor-only stand-in where an image is expected but none was picked yet — the image flavour
// of SiteEditingPlaceholder. The public site renders nothing in its place.

type SiteImagePlaceholderProps = {
  hint?:      string
  className?: string
}

export function SiteImagePlaceholder({ hint = "Ajoutez une image dans le panneau de droite", className }: SiteImagePlaceholderProps) {
  return <SiteEditingPlaceholder className={className}>{hint}</SiteEditingPlaceholder>
}
