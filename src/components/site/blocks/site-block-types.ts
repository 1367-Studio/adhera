import type { ComponentProps } from "react"
import type { SiteActualitesSection } from "@/components/site/sections/site-actualites-section"
import type { SiteBoutiqueSection } from "@/components/site/sections/site-boutique-section"
import type { SiteEventsSection } from "@/components/site/sections/site-events-section"

// Shared contract of the site builder blocks (FORM-7). Every block lives in its own file under
// src/components/site/blocks/ and exports one Puck ComponentConfig<Props>; site-puck-config.tsx
// only assembles them.

export type FormBinding = { slug: string; title: string }

// Live association data handed to <Puck metadata> / <Render metadata>; every render function
// reads it through puck.metadata (see readSiteMetadata).
export type SitePuckMetadata = {
  associationName:         string
  slug:                    string
  city:                    string | null
  country:                 string
  // Contact details from Paramètres → Identité, for the Contact block. Null when not filled.
  address:                 string | null
  phone:                   string | null
  contactEmail:            string | null
  website:                 string | null
  events:                  ComponentProps<typeof SiteEventsSection>["events"]
  actualites:              ComponentProps<typeof SiteActualitesSection>["actualites"]
  boutiqueProduits:        ComponentProps<typeof SiteBoutiqueSection>["produits"]
  membershipFormBySection: Record<string, FormBinding>
  donationFormBySection:   Record<string, FormBinding>
  usesDonationForms:       boolean
  membershipCta:           { href: string } | null
  canIssueTaxReceipts:     boolean
}

export function readSiteMetadata(metadata: unknown): SitePuckMetadata {
  return metadata as SitePuckMetadata
}
