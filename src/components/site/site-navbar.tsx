"use client"

import Link from "next/link"
import { isColorDark } from "@/lib/color"

type Props = {
  name:               string
  logoUrl?:           string
  color:              string
  portalSlug:         string
  headerBgColor?:     string
  headerShowMembres?: boolean
  headerShowRegister?: boolean
  // The public MembershipForm to send visitors to — null when the association has none
  // published on the site, in which case the button never renders regardless of
  // headerShowRegister (there's nothing to send anyone to).
  membershipCta?:     { href: string } | null
}

export function SiteNavbar({ name, logoUrl, color, portalSlug, headerBgColor, headerShowMembres = true, headerShowRegister = true, membershipCta = null }: Props) {
  const bg     = headerBgColor || "#ffffff"
  const isDark = isColorDark(bg)
  const textColor = isDark ? "#fff" : "#111827"

  return (
    <nav className="sticky top-0 z-50 backdrop-blur border-b border-black/5" style={{ background: bg }}>
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href={`/${portalSlug}`} className="flex items-center gap-2.5 font-semibold" style={{ color: textColor }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={name} width={40} height={40} className="rounded size-10 object-contain" />
          ) : (
            <span className="size-10 rounded flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: color }}>
              {name[0]?.toUpperCase()}
            </span>
          )}
          <span className="text-sm">{name}</span>
        </Link>

        {(headerShowMembres || (headerShowRegister && membershipCta)) && (
          <div className="flex items-center gap-2">
            {headerShowRegister && membershipCta && (
              <Link
                href={membershipCta.href}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
                style={{ color, borderColor: color }}
              >
                Adhérer
              </Link>
            )}
            {headerShowMembres && (
              <Link
                href={`/portal/${portalSlug}/login`}
                className="text-sm font-medium px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
                style={{ background: color }}
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

