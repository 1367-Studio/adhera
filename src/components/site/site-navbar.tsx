"use client"

import Link from "next/link"
import { isColorDark } from "@/lib/color"
import { SiteSocialIcons, visibleSocialLinks, type SocialLink } from "@/components/site/site-social-icons"

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
}

export function SiteNavbar({ name, logoUrl, color, secondaryColor, portalSlug, headerBgColor, headerShowMembres = true, headerShowRegister = true, membershipCta = null, showName = true, socialLinks = [] }: Props) {
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

        {(headerShowMembres || (headerShowRegister && membershipCta) || hasSocialLinks) && (
          <div className="flex items-center gap-2">
            {hasSocialLinks && (
              <SiteSocialIcons socialLinks={socialLinks} className="hidden sm:flex" />
            )}
            {headerShowRegister && membershipCta && (
              <Link
                href={membershipCta.href}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
                style={{ color: secondaryColor ?? color, borderColor: secondaryColor ?? color }}
              >
                Adhérer
              </Link>
            )}
            {headerShowMembres && (
              <Link
                href={`/portal/${portalSlug}/login`}
                className="text-sm font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
                style={{ background: color, color: "var(--site-primary-foreground)" }}
              >
                Se connecter
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}

