"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

type Props = {
  slug: string
  className?: string
  // Whether `/${slug}` actually resolves to something (getSiteData requires sitePublished AND
  // the "site" module) — boutique/dons/adhesion work with no public site at all, so linking
  // there unconditionally would 404 for most associations. `website` is the association's own
  // external site (unrelated to the Formwise builder) — the fallback when there's no Formwise
  // site to send the visitor back to. Omit both (or pass sitePublished={false} with no website)
  // to render nothing rather than a link that's known to be dead.
  sitePublished: boolean
  website?: string | null
}

function externalHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

// The one way back to the association's own site from a checkout/registration flow (adhesion,
// boutique, evenements, dons) — shown both during the flow and on its confirmation screen, so
// a visitor is never stranded on a bare page once they've paid, signed up or donated.
export function BackToSiteLink({ slug, className, sitePublished, website }: Props) {
  const t = useTranslations("common")
  // py-1.5 -my-1.5 widens the tap target on touch screens without pushing surrounding
  // elements apart — the extra padding is cancelled back out by the negative margin.
  const linkClassName = cn("inline-flex items-center gap-1.5 py-1.5 -my-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors", className)

  if (!sitePublished) {
    if (!website) return null
    return (
      <a href={externalHref(website)} className={linkClassName}>
        <ArrowLeftIcon className="size-3.5" />
        {t("backToSite")}
      </a>
    )
  }

  return (
    <Link
      href={`/${slug}`}
      // Not a link the visitor is likely to follow (it's an exit, not the next step), and
      // every public page view would otherwise trigger a prefetch — a getSiteData() query —
      // just for being on screen.
      prefetch={false}
      className={linkClassName}
    >
      <ArrowLeftIcon className="size-3.5" />
      {t("backToSite")}
    </Link>
  )
}
