"use client"

import { useState } from "react"
import Link from "next/link"
import { ListIcon, XIcon } from "@phosphor-icons/react/dist/ssr"
import { isColorDark } from "@/lib/color"
import { cn } from "@/lib/utils"
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { SiteSocialIcons, visibleSocialLinks, type SocialLink } from "@/components/site/site-social-icons"
import { PublicSiteLocaleSwitcher } from "@/components/site/public-site-locale-switcher"
import { SiteHeaderAdhesionMenu } from "@/components/site/site-header-adhesion-menu"
import { resolveSiteHref, isExternalHref } from "@/components/site/blocks/site-block-button"
import type { SiteLink } from "@/components/site/blocks/site-block-fields"
import {
  headerPillClassName, headerPillStyle, menuContentStyle, menuDrawerButtonColors,
  type HeaderPillVariant, type HeaderLinkItem, type MenuContentBackground, type HeaderMenuButtonColor,
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
  // Published custom pages (FORM-7 "Pages") flagged for the nav and grouped into one of the
  // association's own named dropdown menus (same component as the adhesion menu) rather than
  // one button per page, so the header stays compact no matter how many pages pile up. Each
  // menu with no visible page inside is already filtered out upstream (site-page-nav.ts).
  pagesMenus?:           { id: string; label: string; items: SiteLink[] }[]
  // Resolved primary color/foreground (real hex, not "var(--site-primary)") — needed by the
  // adhesion dropdown's panel specifically, since it's portaled outside this component's DOM
  // subtree and can't inherit the custom property `color` above may just be a reference to.
  resolvedPrimaryColor?:      string
  resolvedPrimaryForeground?: string
  // "Se connecter" was always filled before this existed — default stays "primary" so nobody's
  // header changes just because this field now exists.
  seConnecterVariant?:   HeaderPillVariant
  // Below lg every control above moves into a side drawer opened by a burger button (the
  // inline row overflows phones and tablets). The burger is neutral by default ("ghost");
  // the drawer is light by default, and on a "primary" background menuButtonColor picks
  // whether its buttons contrast with it or use the secondary color.
  menuButtonVariant?:    HeaderPillVariant
  menuBackground?:       MenuContentBackground
  menuButtonColor?:      HeaderMenuButtonColor
}

// Muted group heading inside the drawer (the adhesion links have no dropdown there).
const DRAWER_HEADING_CLASSNAME = "text-xs font-medium opacity-70 pt-2"
// Same square, padding-free pill for the burger and the drawer's close button.
const ICON_PILL_CLASSNAME = "inline-flex size-10 items-center justify-center p-0"

export function SiteNavbar({
  name, logoUrl, color, secondaryColor, portalSlug, headerBgColor, headerShowMembres = true, headerShowRegister = true,
  membershipCta = null, showName = true, socialLinks = [], ui = SITE_UI_STRINGS, showTranslate = false, locale,
  headerLinks = [], adhesionMenuLabel, adhesionMenuItems = [], adhesionMenuVariant = "outline",
  adhesionMenuContentBackground = "light", resolvedPrimaryColor, resolvedPrimaryForeground, seConnecterVariant = "primary",
  menuButtonVariant = "ghost", menuBackground = "light", menuButtonColor = "contrast",
  pagesMenus = [],
}: Props) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  // The drawer's portal target: an empty sibling of <nav>, inside the site chrome div that
  // declares --site-primary/--site-secondary/… and the site font, so the drawer can use them
  // (document.body, the Sheet's default, is outside it). Not the <nav> itself: its
  // backdrop-blur makes it the containing block of `position: fixed` descendants, which would
  // trap the drawer inside the 64px bar. State rather than a ref so the Sheet re-renders once
  // the element exists.
  const [menuPortalContainer, setMenuPortalContainer] = useState<HTMLDivElement | null>(null)

  const hasSocialLinks = visibleSocialLinks(socialLinks).length > 0
  const hasLocaleSwitcher = showTranslate && !!locale
  const hasHeaderControls = headerShowMembres || (headerShowRegister && !!membershipCta) || hasSocialLinks
    || hasLocaleSwitcher || headerLinks.length > 0 || adhesionMenuItems.length > 0 || pagesMenus.length > 0
  const bg     = headerBgColor || "#ffffff"
  const isDark = isColorDark(bg)
  const textColor = isDark ? "#fff" : "#111827"

  const adhesionLabel = adhesionMenuLabel || ui.navAdherer
  const drawerStyle = menuContentStyle(menuBackground, "var(--site-primary)", "var(--site-primary-foreground)")
  const closeMenu = () => setIsMenuOpen(false)
  // Every drawer button keeps its configured variant but takes the drawer's own colors — the
  // header's accents were picked against the header background, not the drawer's. h-11: a
  // comfortable touch target, since the drawer only ever shows on phones and tablets.
  const drawerPillClassName = (variant: HeaderPillVariant) =>
    cn(headerPillClassName(variant), "flex h-11 w-full items-center justify-center")
  const drawerPillStyle = (variant: HeaderPillVariant) => {
    const drawerButtonColors = menuDrawerButtonColors(menuBackground, menuButtonColor, variant)
    return headerPillStyle(variant, drawerButtonColors.accent, drawerButtonColors.foreground)
  }

  return (
    <>
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

          {hasHeaderControls && (
            <div className="hidden lg:flex items-center gap-2">
              {hasSocialLinks && (
                <SiteSocialIcons socialLinks={socialLinks} className="hidden sm:flex" />
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
                  label={adhesionLabel}
                  items={adhesionMenuItems}
                  slug={portalSlug}
                  color={adhesionMenuVariant === "primary" ? color : (secondaryColor ?? color)}
                  variant={adhesionMenuVariant}
                  primaryColor={resolvedPrimaryColor ?? color}
                  primaryForeground={resolvedPrimaryForeground ?? "var(--site-primary-foreground)"}
                  contentBackground={adhesionMenuContentBackground}
                />
              )}
              {pagesMenus.map(menu => (
                <SiteHeaderAdhesionMenu
                  key={menu.id}
                  label={menu.label}
                  items={menu.items}
                  slug={portalSlug}
                  color={secondaryColor ?? color}
                  variant="outline"
                  primaryColor={resolvedPrimaryColor ?? color}
                  primaryForeground={resolvedPrimaryForeground ?? "var(--site-primary-foreground)"}
                  contentBackground="light"
                />
              ))}
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
              {showTranslate && locale && (
                <PublicSiteLocaleSwitcher locale={locale} />
              )}
            </div>
          )}

          {hasHeaderControls && (
            // Controlled so each link below can close the drawer: an internal next/link
            // navigation doesn't unmount this navbar, so the dialog wouldn't close by itself.
            <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <SheetTrigger
                render={
                  <button
                    type="button"
                    aria-label={ui.navMenu}
                    className={cn(headerPillClassName(menuButtonVariant), ICON_PILL_CLASSNAME, "lg:hidden")}
                    // A burger is neutral UI: the header's own text color, unless the
                    // association explicitly asked for the filled primary look.
                    style={headerPillStyle(menuButtonVariant, menuButtonVariant === "primary" ? color : textColor)}
                  />
                }
              >
                <ListIcon className="size-4" />
              </SheetTrigger>
              <SheetContent
                side="right"
                container={menuPortalContainer}
                showCloseButton={false}
                className="gap-0 p-0 data-[side=right]:border-l-0"
                // Replaces the panel's bg-popover/text-popover-foreground, admin tokens the
                // public site never defines.
                style={drawerStyle}
              >
                <div className="flex items-center justify-between px-4 h-16">
                  {/* SheetTitle's font-heading/text-foreground are admin tokens too — inherit instead. */}
                  <SheetTitle className="text-sm font-semibold text-current" style={{ fontFamily: "inherit" }}>
                    {name}
                  </SheetTitle>
                  <SheetClose
                    render={
                      <button
                        type="button"
                        aria-label={ui.navClose}
                        className={cn(headerPillClassName("ghost"), ICON_PILL_CLASSNAME)}
                      />
                    }
                  >
                    <XIcon className="size-4" />
                  </SheetClose>
                </div>

                {/* One scroll area for the links and the bottom group, so neither gets cut off
                    on a short screen (landscape phone, many links). mt-auto keeps the bottom
                    group pinned to the bottom whenever everything fits. */}
                <div className="flex flex-1 flex-col overflow-y-auto">
                  <div className="flex flex-col gap-2 px-4 py-2">
                    {headerLinks.map((link, index) => {
                      const href    = resolveSiteHref(link.href, portalSlug)
                      const variant = link.variant ?? "outline"
                      return isExternalHref(href) ? (
                        <a
                          key={`${link.label}-${index}`}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={closeMenu}
                          className={drawerPillClassName(variant)}
                          style={drawerPillStyle(variant)}
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          key={`${link.label}-${index}`}
                          href={href}
                          onClick={closeMenu}
                          className={drawerPillClassName(variant)}
                          style={drawerPillStyle(variant)}
                        >
                          {link.label}
                        </Link>
                      )
                    })}
                    {adhesionMenuItems.length > 0 && (
                      <>
                        <p className={DRAWER_HEADING_CLASSNAME}>{adhesionLabel}</p>
                        {adhesionMenuItems.map((item, index) => {
                          const href = resolveSiteHref(item.href, portalSlug)
                          return isExternalHref(href) ? (
                            <a
                              key={`${item.label}-${index}`}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={closeMenu}
                              className={drawerPillClassName(adhesionMenuVariant)}
                              style={drawerPillStyle(adhesionMenuVariant)}
                            >
                              {item.label}
                            </a>
                          ) : (
                            <Link
                              key={`${item.label}-${index}`}
                              href={href}
                              onClick={closeMenu}
                              className={drawerPillClassName(adhesionMenuVariant)}
                              style={drawerPillStyle(adhesionMenuVariant)}
                            >
                              {item.label}
                            </Link>
                          )
                        })}
                      </>
                    )}
                    {pagesMenus.map(menu => (
                      <div key={menu.id} className="contents">
                        <p className={DRAWER_HEADING_CLASSNAME}>{menu.label}</p>
                        {menu.items.map((item, index) => {
                          const href = resolveSiteHref(item.href, portalSlug)
                          return isExternalHref(href) ? (
                            <a
                              key={`${item.label}-${index}`}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={closeMenu}
                              className={drawerPillClassName("outline")}
                              style={drawerPillStyle("outline")}
                            >
                              {item.label}
                            </a>
                          ) : (
                            <Link
                              key={`${item.label}-${index}`}
                              href={href}
                              onClick={closeMenu}
                              className={drawerPillClassName("outline")}
                              style={drawerPillStyle("outline")}
                            >
                              {item.label}
                            </Link>
                          )
                        })}
                      </div>
                    ))}
                    {headerShowRegister && membershipCta && (
                      <Link
                        href={membershipCta.href}
                        onClick={closeMenu}
                        className={drawerPillClassName("outline")}
                        style={drawerPillStyle("outline")}
                      >
                        {ui.navAdherer}
                      </Link>
                    )}
                    {headerShowMembres && (
                      <Link
                        href={`/portal/${portalSlug}/login`}
                        onClick={closeMenu}
                        className={drawerPillClassName(seConnecterVariant)}
                        style={drawerPillStyle(seConnecterVariant)}
                      >
                        {ui.navSeConnecter}
                      </Link>
                    )}
                  </div>

                  {(hasSocialLinks || hasLocaleSwitcher) && (
                    <div className="mt-auto border-t border-current/10 px-4 py-4 flex flex-col gap-4">
                      {hasSocialLinks && <SiteSocialIcons socialLinks={socialLinks} />}
                      {showTranslate && locale && (
                        <PublicSiteLocaleSwitcher locale={locale} layout="list" listLabel={ui.navLanguage} />
                      )}
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </nav>
      <div ref={setMenuPortalContainer} />
    </>
  )
}
