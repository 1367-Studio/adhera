import type { CSSProperties, ReactNode } from "react"
import type { ArrayField } from "@puckeditor/core"
import { cn } from "@/lib/utils"

// Social network links of the public site: monochrome icons (currentColor) drawn here to avoid
// a brand-icon dependency. Shared by the "Réseaux sociaux" block, the navbar and the footer.

export type SocialNetwork = "facebook" | "instagram" | "linkedin" | "youtube" | "tiktok" | "x" | "site"
export type SocialLink = { network: SocialNetwork; url: string }

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  facebook:  "Facebook",
  instagram: "Instagram",
  linkedin:  "LinkedIn",
  youtube:   "YouTube",
  tiktok:    "TikTok",
  x:         "X",
  site:      "Site web",
}

// Stroke icons on a 24×24 grid.
const SOCIAL_NETWORK_ICONS: Record<SocialNetwork, ReactNode> = {
  facebook:  <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8Z" />,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></>,
  linkedin:  <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" /></>,
  youtube:   <><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m10 9 5 3-5 3V9Z" /></>,
  tiktok:    <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3a5 5 0 0 0 5 5" />,
  x:         <><path d="M4 4h4l12 16h-4L4 4Z" /><path d="m20 4-6.5 7M10.5 13 4 20" /></>,
  site:      <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
}

export function socialLinksField(label = "Réseaux sociaux"): ArrayField<SocialLink[]> {
  return {
    type:  "array",
    label,
    max:   8,
    arrayFields: {
      network: {
        type:    "select",
        label:   "Réseau",
        options: (Object.keys(SOCIAL_NETWORK_LABELS) as SocialNetwork[])
          .map(network => ({ label: SOCIAL_NETWORK_LABELS[network], value: network })),
      },
      url: { type: "text", label: "Adresse (https://…)" },
    },
    defaultItemProps: { network: "facebook", url: "" },
    getItemSummary:   socialLink => SOCIAL_NETWORK_LABELS[socialLink.network] ?? "Lien",
  }
}

/** Links with an address and a known network — the only ones worth rendering. */
export function visibleSocialLinks(socialLinks: SocialLink[] | undefined): SocialLink[] {
  return (socialLinks ?? []).filter(socialLink =>
    typeof socialLink.url === "string" && socialLink.url.trim() !== "" && SOCIAL_NETWORK_LABELS[socialLink.network],
  )
}

const SOCIAL_ICON_STYLES: Record<NonNullable<SiteSocialIconsProps["variant"]>, CSSProperties | undefined> = {
  framed: { borderColor: "currentColor", borderRadius: "var(--site-radius)" },
  plain:  undefined,
  round:  { background: "color-mix(in srgb, currentColor 12%, transparent)" },
}

type SiteSocialIconsProps = {
  socialLinks: SocialLink[] | undefined
  /** "framed": bordered squares (the block); "plain": bare icons (navbar, old footer);
   *  "round": icons in a subtle filled circle (builder footer). */
  variant?:    "framed" | "plain" | "round"
  className?:  string
}

export function SiteSocialIcons({ socialLinks, variant = "plain", className }: SiteSocialIconsProps) {
  const linksToShow = visibleSocialLinks(socialLinks)
  if (linksToShow.length === 0) return null
  return (
    <ul className={cn("flex flex-wrap items-center", variant === "plain" ? "gap-1" : "gap-3", className)}>
      {linksToShow.map((socialLink, linkIndex) => (
        <li key={`${socialLink.network}-${linkIndex}`}>
          <a
            href={socialLink.url.trim()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={SOCIAL_NETWORK_LABELS[socialLink.network]}
            title={SOCIAL_NETWORK_LABELS[socialLink.network]}
            className={cn(
              "flex items-center justify-center transition-opacity hover:opacity-70",
              variant === "framed" && "size-11 border",
              variant === "plain" && "size-9",
              variant === "round" && "size-10 rounded-full",
            )}
            style={SOCIAL_ICON_STYLES[variant]}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={variant === "framed" ? "size-5" : "size-4"}
            >
              {SOCIAL_NETWORK_ICONS[socialLink.network]}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  )
}
