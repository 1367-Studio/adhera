import type { ComponentProps } from "react"
import type { SiteActualitesSection } from "@/components/site/sections/site-actualites-section"
import type { SiteBoutiqueSection } from "@/components/site/sections/site-boutique-section"
import type { SiteEventsSection } from "@/components/site/sections/site-events-section"
import type { Locale } from "@/i18n/locales"
import type { SiteUiStrings } from "@/lib/site-puck/site-ui-strings"

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
  // The visitor's chosen page language (src/lib/i18n/public-locale.ts) and the matching
  // translation of the fixed UI chrome around live data (site-ui-strings.ts) — blocks/chrome
  // read these instead of hardcoding French, for anything that isn't association-authored
  // content (which is translated separately, before this metadata is even built).
  locale:                  Locale
  ui:                      SiteUiStrings
}

export function readSiteMetadata(metadata: unknown): SitePuckMetadata {
  return metadata as SitePuckMetadata
}
