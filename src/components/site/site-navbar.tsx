"use client"

import Link from "next/link"
import { isColorDark } from "@/lib/color"
import { SiteSocialIcons, visibleSocialLinks, type SocialLink } from "@/components/site/site-social-icons"
import { PublicSiteLocaleSwitcher } from "@/components/site/public-site-locale-switcher"
import { SiteHeaderAdhesionMenu } from "@/components/site/site-header-adhesion-menu"
import { resolveSiteHref, isExternalHref } from "@/components/site/blocks/site-block-button"
import type { SiteLink } from "@/components/site/blocks/site-block-fields"
import {
  headerPillClassName, headerPillStyle, type HeaderPillVariant, type HeaderLinkItem, type MenuContentBackground,
} from "@/components/site/site-header-link-style"
import { SITE_UI_STRINGS, type SiteUiStrings } from "@/lib/site-puck/site-ui-strings"
import type { Locale } from "@/i18n/locales"

type Props = {
  name:               string
  logoUrl?:           string
  color:              string
  // Accent color for the outlined "Adhérer" CTA — falls back to `color` when not given
  // (e.g. call sites that only ever had a single palette color before secondaryColor existed).
  secondaryColor?:    string
  portalSlug:         string
  headerBgColor?:     string
  headerShowMembres?: boolean
  headerShowRegister?: boolean
  // The public MembershipForm to send visitors to — null when the association has none
  // published on the site, in which case the button never renders regardless of
  // headerShowRegister (there's nothing to send anyone to).
  membershipCta?:     { href: string } | null
  // Shows the association's name next to the logo. Off when the logo already carries the name
  // (the new site builder hides it once a logo is uploaded); the logo can then be wider.
  showName?:          boolean
  // Social network icons next to the buttons (hidden on phones, where the bar is too narrow).
  socialLinks?:       SocialLink[]
  // Translated "Adhérer"/"Se connecter" labels — defaults to French for the old builder's
  // callers, which don't yet resolve a visitor locale.
  ui?:                SiteUiStrings
  // Language switcher (globe) next to the buttons — off unless both are given: the old
  // builder's callers pass neither (it doesn't resolve a visitor locale yet), so it never
  // renders there regardless of this flag.
  showTranslate?:     boolean
  locale?:            Locale
  // Plain link buttons (internal or external — external opens in a new tab) and, separately,
  // a dropdown for associations with several membership forms (one per country, chapter…).
  headerLinks?:          HeaderLinkItem[]
  adhesionMenuLabel?:    string
  adhesionMenuItems?:    SiteLink[]
  adhesionMenuVariant?:  HeaderPillVariant
  adhesionMenuContentBackground?: MenuContentBackground
  // "Se connecter" was always filled before this existed — default stays "primary" so nobody's
  // header changes just because this field now exists.
  seConnecterVariant?:   HeaderPillVariant
}

export function SiteNavbar({
  name, logoUrl, color, secondaryColor, portalSlug, headerBgColor, headerShowMembres = true, headerShowRegister = true,
  membershipCta = null, showName = true, socialLinks = [], ui = SITE_UI_STRINGS, showTranslate = false, locale,
  headerLinks = [], adhesionMenuLabel, adhesionMenuItems = [], adhesionMenuVariant = "outline",
  adhesionMenuContentBackground = "light", seConnecterVariant = "primary",
}: Props) {
  const hasSocialLinks = visibleSocialLinks(socialLinks).length > 0
  const bg     = headerBgColor || "#ffffff"
  const isDark = isColorDark(bg)
  const textColor = isDark ? "#fff" : "#111827"

  return (
    <nav className="sticky top-0 z-50 backdrop-blur border-b border-black/5" style={{ background: bg }}>
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link
          href={`/${portalSlug}`}
          className="flex items-center gap-2.5 font-semibold"
          style={{ color: textColor }}
          aria-label={showName ? undefined : name}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={name}
              height={40}
              className={showName ? "rounded size-10 object-contain" : "h-10 w-auto max-w-48 object-contain"}
            />
          ) : (
            <span
              className="size-10 rounded flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: color, color: "var(--site-primary-foreground)" }}
            >
              {name[0]?.toUpperCase()}
            </span>
          )}
          {showName && <span className="text-sm">{name}</span>}
        </Link>

        {(
          headerShowMembres || (headerShowRegister && membershipCta) || hasSocialLinks
          || (showTranslate && locale) || headerLinks.length > 0 || adhesionMenuItems.length > 0
        ) && (
          <div className="flex items-center gap-2">
            {hasSocialLinks && (
              <SiteSocialIcons socialLinks={socialLinks} className="hidden sm:flex" />
            )}
            {showTranslate && locale && (
              <PublicSiteLocaleSwitcher locale={locale} />
            )}
            {headerLinks.map((link, index) => {
              const href    = resolveSiteHref(link.href, portalSlug)
              const variant = link.variant ?? "outline"
              // "primary" means the brand's true primary color, never the softer secondary
              // accent the outline/ghost looks use — see headerPillStyle's own comment.
              const accent  = variant === "primary" ? color : (secondaryColor ?? color)
              const linkClassName = headerPillClassName(variant)
              const linkStyle     = headerPillStyle(variant, accent)
              return isExternalHref(href) ? (
                <a key={`${link.label}-${index}`} href={href} target="_blank" rel="noopener noreferrer" className={linkClassName} style={linkStyle}>
                  {link.label}
                </a>
              ) : (
                <Link key={`${link.label}-${index}`} href={href} className={linkClassName} style={linkStyle}>
                  {link.label}
                </Link>
              )
            })}
            {adhesionMenuItems.length > 0 && (
              <SiteHeaderAdhesionMenu
                label={adhesionMenuLabel || ui.navAdherer}
                items={adhesionMenuItems}
                slug={portalSlug}
                color={adhesionMenuVariant === "primary" ? color : (secondaryColor ?? color)}
                variant={adhesionMenuVariant}
                primaryColor={color}
                contentBackground={adhesionMenuContentBackground}
              />
            )}
            {headerShowRegister && membershipCta && (
              <Link
                href={membershipCta.href}
                className={headerPillClassName("outline")}
                style={headerPillStyle("outline", secondaryColor ?? color)}
              >
                {ui.navAdherer}
              </Link>
            )}
            {headerShowMembres && (
              <Link
                href={`/portal/${portalSlug}/login`}
                className={headerPillClassName(seConnecterVariant)}
                style={headerPillStyle(seConnecterVariant, color)}
              >
                {ui.navSeConnecter}
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}

