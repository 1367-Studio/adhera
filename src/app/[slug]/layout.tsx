import type { ReactNode } from "react"
import { prisma } from "@/lib/prisma/client"
import { SITE_FONTS, SITE_DEFAULT_FONT, isSiteFontKey } from "@/lib/site-fonts"
import type { SiteConfig } from "@/types/site-config"

// Shared by every /[slug]/** route (homepage, evenements/[id], boutique/*, adhesion/*,
// dons/*, actualites/[id]) — the one place the association's chosen site font applies, so a
// visitor lands on the same typography whichever public page they open first. Deliberately
// does no 404/publish gating itself: each page already owns that logic (see [slug]/page.tsx's
// getSiteData), and an invalid slug here just falls through to the default font while the
// page underneath renders its own not-found state.
export default async function SiteLayout(
  { children, params }: { children: ReactNode; params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { siteConfig: true },
  })
  const config = assoc?.siteConfig as SiteConfig | null
  const requestedFont = config?.fontFamily
  const fontKey = isSiteFontKey(requestedFont) ? requestedFont : SITE_DEFAULT_FONT
  const font = SITE_FONTS[fontKey]

  return (
    <div className={font.variable} style={{ fontFamily: font.cssVar }}>
      {children}
    </div>
  )
}
