"use client"

import type { ReactNode } from "react"
import { SiteNavbar } from "@/components/site/site-navbar"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteBuilderChrome } from "@/components/site/site-builder-chrome"
import { useSitePuckChrome } from "@/components/site/site-puck-chrome-context"
import { getSiteColorVars } from "@/lib/site-theme"
import type { SiteConfig } from "@/types/site-config"

export type PublicSiteInfo = { name: string; config: SiteConfig | null }

// The association's own navbar + footer around a standalone public page, so a visitor who
// lands on a legal document still has the rest of the site one click away.
//
// The public pages are always light: they follow the association's own site palette, not the
// visitor's dark-mode preference, hence the explicit colorScheme.
//
// A site published from the new builder gets that builder's header, footer and style instead
// (root settings provided by [slug]/layout.tsx); every other site keeps the old chrome below.
export function SitePublicChrome(
  { site, slug, children }: { site: PublicSiteInfo; slug: string; children: ReactNode },
) {
  const puckChrome = useSitePuckChrome()
  const config = site.config
  const color  = "var(--site-primary)"

  if (puckChrome) {
    return (
      <SiteBuilderChrome
        rootProps={puckChrome.rootProps}
        associationName={site.name}
        slug={slug}
        membershipCta={null}
        locale={puckChrome.locale}
        ui={puckChrome.ui}
        className="min-h-screen flex flex-col bg-white text-gray-900"
        mainClassName="flex-1"
      >
        {children}
      </SiteBuilderChrome>
    )
  }

  return (
    <div
      className="min-h-screen flex flex-col bg-white text-gray-900"
      style={{ colorScheme: "light", ...getSiteColorVars(config) }}
    >
      <SiteNavbar
        name={site.name}
        logoUrl={config?.logoUrl}
        color={color}
        secondaryColor="var(--site-secondary)"
        portalSlug={slug}
        headerBgColor={config?.headerBgColor}
        headerShowMembres={config?.headerShowMembres}
        headerShowRegister={config?.headerShowRegister}
        membershipCta={null}
      />
      <main className="flex-1">{children}</main>
      <SiteFooter
        name={site.name}
        footerText={config?.footerText}
        footerBgColor={config?.footerBgColor}
        footerLinks={config?.footerLinks}
        color={color}
      />
    </div>
  )
}
