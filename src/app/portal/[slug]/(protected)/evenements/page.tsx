"use client"

import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, useRef, useEffect, Suspense } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner"
import { RsvpBadge } from "@/components/portal/rsvp-badge"
import { RichTextView } from "@/components/ui/rich-text-view"
import { EventParticipation } from "@/components/portal/evenements/event-participation"
import { EventMeta } from "@/components/portal/evenements/event-meta"
import { evenementHasFee, type Evenement } from "@/components/portal/evenements/types"
import { cn } from "@/lib/utils"

type ApiResponse = { upcoming: Evenement[]; past: Evenement[]; upcomingHasMore: boolean; pastHasMore: boolean }

function EventCard({
  evenement,
  isPast,
  connectEnabled,
  optimisticPaidId,
}: {
  evenement:        Evenement
  isPast?:          boolean
  connectEnabled:   boolean
  optimisticPaidId: string | null
}) {
  const t           = useTranslations("portalMembre.evenements")
  const { slug }    = useParams<{ slug: string }>()
  const detailHref  = `/portal/${slug}/evenements/${evenement.id}`
  const currentRsvp = evenement.participations[0]?.rsvp ?? null
  const hasFee      = evenementHasFee(evenement)

  return (
    <div className={cn(
      "rounded-lg border bg-card p-5 space-y-4 transition-colors",
      isPast && "opacity-75 hover:opacity-100",
    )}>
      {evenement.imageUrl && (
        // Same destination as the title link: hidden from the tab order / screen readers so
        // keyboard users don't hit two identical links per card.
        <Link href={detailHref} tabIndex={-1} aria-hidden className="block rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={evenement.imageUrl} alt="" className="w-full aspect-video rounded-md object-cover" />
        </Link>
      )}

      {/* Header */}
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug">
            <Link href={detailHref} className="hover:underline underline-offset-2">
              {evenement.title}
            </Link>
          </h3>
          {currentRsvp && !hasFee && <RsvpBadge rsvp={currentRsvp} className="shrink-0" />}
        </div>
        {evenement.description && (
          <RichTextView content={evenement.description} className="text-xs text-muted-foreground line-clamp-3" />
        )}
        <EventMeta evenement={evenement} className="pt-0.5" />
        <Link
          href={detailHref}
          className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline self-start"
        >
          {t("viewEvent")} <CaretRightIcon className="size-3.5" />
        </Link>
      </div>

      <EventParticipation
        evenement={evenement}
        isPast={isPast}
        connectEnabled={connectEnabled}
        optimisticPaidId={optimisticPaidId}
      />
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-4 animate-pulse">
      <div className="space-y-2.5">
        <div className="h-4 w-3/5 rounded-md bg-muted" />
        <div className="h-3 w-full rounded-md bg-muted" />
        <div className="h-3 w-4/5 rounded-md bg-muted" />
        <div className="flex gap-4 pt-0.5">
          <div className="h-3 w-28 rounded-md bg-muted" />
          <div className="h-3 w-20 rounded-md bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[0,1,2,3].map(placeholderIndex => <div key={placeholderIndex} className="h-9 rounded-lg bg-muted" />)}
      </div>
    </div>
  )
}

export default function EvenementsPortalPage() {
  return (
    <Suspense fallback={null}>
      <EvenementsPortalPageInner />
    </Suspense>
  )
}

// useSearchParams() (for the Stripe ticket=success/cancelled redirect) requires a
// Suspense boundary above it, or `next build` fails prerendering this page.
function EvenementsPortalPageInner() {
  const t              = useTranslations("portalMembre.evenements")
  const searchParams   = useSearchParams()
  const router         = useRouter()
  const queryClient    = useQueryClient()
  const toastShownRef  = useRef(false)

  // optimistic: eventId just paid (before webhook fires)
  const [optimisticPaidId, setOptimisticPaidId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: ["portal-evenements"],
    queryFn:  () => fetch("/api/portal/evenements").then(response => response.json()),
    staleTime: 0,
    gcTime:    0,
  })

  const { data: connectData } = useQuery<{ enabled: boolean }>({
    queryKey: ["portal-connect-status"],
    queryFn:  () => fetch("/api/portal/connect-status").then(response => response.json()),
  })

  useEffect(() => {
    if (toastShownRef.current) return
    const result = searchParams.get("ticket")
    if (!result) return

    toastShownRef.current = true

    if (result === "success") {
      const paidEvenementId = searchParams.get("eid")
      if (paidEvenementId) setOptimisticPaidId(paidEvenementId)
      toast.success(t("ticketPurchaseSuccessToast"))
      queryClient.invalidateQueries({ queryKey: ["portal-evenements"] })
    } else if (result === "cancelled") {
      toast.info(t("paymentCancelledToast"))
    }

    // Clean URL so refresh/share doesn't re-trigger
    router.replace(window.location.pathname, { scroll: false })
  }, [searchParams, router, queryClient, t])

  const upcoming       = data?.upcoming        ?? []
  const past           = data?.past            ?? []
  const upcomingHasMore = data?.upcomingHasMore ?? false
  const pastHasMore    = data?.pastHasMore     ?? false
  const connectEnabled = connectData?.enabled  ?? false

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("upcomingHeading")}</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0,1,2].map(placeholderIndex => <SkeletonCard key={placeholderIndex} />)}
          </div>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t("noneUpcoming")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {upcoming.map(evenement => (
                <EventCard
                  key={evenement.id}
                  evenement={evenement}
                  connectEnabled={connectEnabled}
                  optimisticPaidId={optimisticPaidId}
                />
              ))}
            </div>
            {upcomingHasMore && (
              <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
                <CaretRightIcon className="size-3.5" />
                {t("moreUpcomingHint")}
              </p>
            )}
          </div>
        )}
      </section>

      {(isLoading || past.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("pastHeading")}</h2>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SkeletonCard />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {past.map(evenement => (
                  <EventCard
                    key={evenement.id}
                    evenement={evenement}
                    isPast
                    connectEnabled={connectEnabled}
                    optimisticPaidId={optimisticPaidId}
                  />
                ))}
              </div>
              {pastHasMore && (
                <p className="text-xs text-center text-muted-foreground">
                  {t("pastLimitHint")}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
