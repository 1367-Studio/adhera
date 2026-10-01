"use client"

import type { ReactNode } from "react"
import { SiteNavbar } from "@/components/site/site-navbar"
import { SiteBuilderFooter } from "@/components/site/site-builder-footer"
import { getSiteStyleVars } from "@/components/site/blocks/site-block-theme"
import { getSiteColorVars } from "@/lib/site-theme"
import { SITE_DEFAULT_FONT, SITE_FONTS, isSiteFontKey } from "@/lib/site-fonts"
import type { SitePuckRootProps } from "@/lib/site-puck/site-puck-data"
import { cn } from "@/lib/utils"
import { SiteAnimationsProvider } from "@/components/site/site-animations"
import { SiteCookieConsentProvider, SiteCookieSettingsLink } from "@/components/site/site-cookie-consent"

// Header, footer, colours, corners and font of a site made with the new builder (FORM-7), set
// from the page's root settings. Shared by the page itself (the Puck root render, so the editor,
// the preview and the public homepage) and by the standalone public pages around it
// (SitePublicChrome), so every page of the site wears the same chrome.

const SITE_PRIMARY_COLOR   = "var(--site-primary)"
const SITE_SECONDARY_COLOR = "var(--site-secondary)"

type SiteBuilderChromeProps = {
  rootProps:       SitePuckRootProps
  associationName: string
  slug:            string
  membershipCta:   { href: string } | null
  className?:      string
  mainClassName?:  string
  /** Inside the Puck editor: no reveal animations (blocks must stay visible) and no cookie banner. */
  isEditing?:      boolean
  children:        ReactNode
}

export function SiteBuilderChrome({
  rootProps, associationName, slug, membershipCta, className, mainClassName, isEditing = false, children,
}: SiteBuilderChromeProps) {
  // "Discrètes" unless the association turned them off; never while editing.
  const animationLevel = isEditing ? "none" : (rootProps.animations ?? "subtle")
  const fontKey = isSiteFontKey(rootProps.fontFamily) ? rootProps.fontFamily : SITE_DEFAULT_FONT
  const font    = SITE_FONTS[fontKey]
  return (
    <SiteCookieConsentProvider slug={slug} settings={rootProps.cookies} isEditing={isEditing}>
    <SiteAnimationsProvider level={animationLevel}>
    <div
      className={cn(className, font.variable)}
      style={{
        colorScheme: "light",
        fontFamily:  font.cssVar,
        ...getSiteColorVars({ ...rootProps, footerText: rootProps.footerText ?? "", sections: [] }),
        ...getSiteStyleVars(rootProps.cornerStyle),
      }}
    >
      <SiteNavbar
        name={associationName}
        logoUrl={rootProps.logoUrl}
        color={SITE_PRIMARY_COLOR}
        secondaryColor={SITE_SECONDARY_COLOR}
        portalSlug={slug}
        headerBgColor={rootProps.headerBgColor}
        headerShowMembres={rootProps.headerShowMembres}
        headerShowRegister={rootProps.headerShowRegister}
        membershipCta={membershipCta}
        // Automatic: an uploaded logo already carries the name. Without a logo the name
        // always shows, so the header is never left with only an initial.
        showName={!rootProps.logoUrl || rootProps.headerShowName === "show"}
        socialLinks={rootProps.socialInHeader ? rootProps.socialLinks : []}
      />
      <main className={mainClassName}>{children}</main>
      <SiteBuilderFooter
        settings={rootProps.footer}
        legacy={{
          footerText:    rootProps.footerText,
          footerBgColor: rootProps.footerBgColor,
          footerLinks:   rootProps.footerLinks,
        }}
        associationName={associationName}
        siteLogoUrl={rootProps.logoUrl}
        socialLinks={rootProps.socialLinks}
        slug={slug}
        bottomExtra={<SiteCookieSettingsLink />}
      />
    </div>
    </SiteAnimationsProvider>
    </SiteCookieConsentProvider>
  )
}
