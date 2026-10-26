"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowRightIcon, CurrencyEurIcon, StarIcon, UsersIcon } from "@phosphor-icons/react/dist/ssr"
import { StatTile } from "@/components/dashboard/widgets/stat-tile"
import { useEvenementBilan } from "@/hooks/use-evenements"

const RATING_FORMAT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function formatEuroCents(amountCents: number) {
  return (amountCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

// Inline per-event summary under a row of the events list (see evenements-view.tsx). Only
// mounted while the row is expanded, so the bilan is fetched lazily. Same StatTile as the
// Dons/Boutique totals — no extra container around the grid. Both tiles about people and
// money link to the presences page: it is where each seat's check-in and payment are listed.
// Also the tile row of the full bilan page (/dashboard/evenements/[id]/bilan), which passes
// showFullBilanLink={false} since it already is that page.
export function EvenementBilanPanel({ evenementId, regionId, showFullBilanLink = true }: {
  evenementId:        string
  regionId?:          string
  showFullBilanLink?: boolean
}) {
  const t = useTranslations("evenements.view.bilan")
  const tCommon = useTranslations("common")
  const { data: bilan, isLoading, isError } = useEvenementBilan(evenementId, true)

  const presencesHref = `/dashboard/evenements/${evenementId}/presences`
  const reviewsHref   = `/dashboard/evenements/${evenementId}/avaliacoes`

  if (isError) {
    return <p id={regionId} className="text-sm text-muted-foreground">{tCommon("error")}</p>
  }

  const reviewCount = bilan?.reviewCount ?? 0
  const averageRatingLabel = bilan?.averageRating != null ? `${RATING_FORMAT.format(bilan.averageRating)} / 5` : "—"

  const tiles = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatTile
        label={t("participants")}
        value={t("registeredCount", { count: bilan?.registeredCount ?? 0 })}
        detail={t("presentCount", { count: bilan?.presentCount ?? 0 })}
        icon={UsersIcon}
        href={presencesHref}
        isLoading={isLoading}
      />
      <StatTile
        label={t("revenue")}
        value={formatEuroCents(bilan?.revenueCents ?? 0)}
        detail={t("afterRefunds")}
        icon={CurrencyEurIcon}
        href={presencesHref}
        isLoading={isLoading}
      />
      <StatTile
        label={t("reviews")}
        value={averageRatingLabel}
        detail={reviewCount > 0 ? t("reviewCount", { count: reviewCount }) : t("noReviews")}
        icon={StarIcon}
        href={reviewsHref}
        isLoading={isLoading}
      />
    </div>
  )

  if (!showFullBilanLink) return <div id={regionId}>{tiles}</div>
  return (
    <div id={regionId} className="space-y-3">
      {tiles}
      <Link
        href={`/dashboard/evenements/${evenementId}/bilan`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {t("fullLink")}
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </div>
  )
}
