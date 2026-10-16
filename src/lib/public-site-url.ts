import { APP_URL } from "@/lib/env"
import type { CustomDomainStatus } from "@prisma/client"

type PublicSiteUrlInput = {
  sitePublished:      boolean
  siteModuleEnabled:  boolean
  slug:               string
  customDomain?:      string | null
  customDomainStatus?: CustomDomainStatus | null
}

// Mirrors the host match the proxy itself uses to route a verified domain to this
// association (src/lib/custom-domain-lookup.ts) — PENDING/FAILED must still fall back
// to the slug URL, since the domain isn't actually serving the site yet.
export function getPublicSiteUrl({
  sitePublished, siteModuleEnabled, slug, customDomain, customDomainStatus,
}: PublicSiteUrlInput): string | null {
  if (!sitePublished || !siteModuleEnabled) return null
  if (customDomain && customDomainStatus === "VERIFIED") return `https://${customDomain}`
  return `${APP_URL}/${slug}`
}
