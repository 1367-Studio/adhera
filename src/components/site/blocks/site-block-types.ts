import type { ComponentProps } from "react"
import type { SiteActualitesSection } from "@/components/site/sections/site-actualites-section"
import type { SiteBoutiqueSection } from "@/components/site/sections/site-boutique-section"
import type { SiteEventsSection } from "@/components/site/sections/site-events-section"
import type { SitePageNavLinks } from "@/lib/site-puck/site-page-nav"
import type { Locale } from "@/i18n/locales"
import type { SiteUiStrings } from "@/lib/site-puck/site-ui-strings"

// Shared contract of the site builder blocks (FORM-7). Every block lives in its own file under
// src/components/site/blocks/ and exports one Puck ComponentConfig<Props>; site-puck-config.tsx
// only assembles them.

export type FormBinding = { slug: string; title: string }

export type SiteEventReview = {
  id:        string
  eventId:   string
  eventTitle: string
  eventDate: string
  rating:    number
  comment:   string | null
  displayName: string
  // Editor-only context (never shown publicly): lets the block's event picker warn an admin
  // before they feature a review tied to a private or unpublished event — see
  // site-block-event-reviews.tsx's EventIdsField.
  eventStatus:     "DRAFT" | "PUBLISHED" | "ARCHIVED"
  eventVisibility: "LINK" | "PRIVATE"
}

// Shared by site-public-data.ts (public site) and /api/site-preview-data (editor) so the
// "Prénom N."/anonymous-label resolution can never drift between the two — a reviewer's last
// name and email never leave this function.
export function eventReviewDisplayName(
  firstName: string, lastName: string, anonymous: boolean, anonymousLabel: string,
): string {
  if (anonymous) return anonymousLabel
  const lastInitial = lastName.trim().charAt(0)
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName
}

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
  // Reviews an association has both received consent for and explicitly chosen to feature —
  // see EvenementAvis.publicationAgreedAt/featuredOnSite. displayName is pre-resolved here
  // ("Prénom N." or the anonymous label) so no block ever needs lastName/email.
  eventReviews:            SiteEventReview[]
  membershipFormBySection: Record<string, FormBinding>
  donationFormBySection:   Record<string, FormBinding>
  usesDonationForms:       boolean
  membershipCta:           { href: string } | null
  canIssueTaxReceipts:     boolean
  // Published custom pages (FORM-7 "Pages") flagged to appear in the header/mobile drawer,
  // already ordered by their navPosition and split into plain buttons vs. the association's
  // own named dropdown menus, per each page's own choice — see SiteBuilderChrome.
  navPages:                SitePageNavLinks
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
