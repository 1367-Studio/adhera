"use client"

import { useQuery } from "@tanstack/react-query"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { RichTextView, DOCUMENT_PROSE } from "@/components/ui/rich-text-view"
import { Skeleton } from "@/components/ui/skeleton"
import { EventParticipation } from "@/components/portal/evenements/event-participation"
import { EventMeta } from "@/components/portal/evenements/event-meta"
import type { Evenement } from "@/components/portal/evenements/types"
import { isEvenementOver } from "@/lib/evenement-timing"

const LOADING_LINE_KEYS = ["first", "second", "third", "fourth", "fifth"]

export default function EvenementDetailPage() {
  const t            = useTranslations("portalMembre.evenements")
  const { slug, id } = useParams<{ slug: string; id: string }>()
  const listHref     = `/portal/${slug}/evenements`

  const { data: evenement, isLoading, isError } = useQuery<Evenement>({
    // Under the ["portal-evenements"] prefix so RSVP / ticket mutations (which invalidate
    // that prefix) refresh this page too. Not ["portal-evenements", id]: that would collide
    // with the ["portal-evenements", id, "tickets"] query.
    queryKey: ["portal-evenements", "detail", id],
    queryFn:  async () => {
      const response = await fetch(`/api/portal/evenements/${id}`)
      if (!response.ok) throw new Error(`Event request failed (${response.status})`)
      const payload = await response.json() as { evenement: Evenement }
      return payload.evenement
    },
    staleTime: 0,
    retry:     false,
  })

  const { data: connectData } = useQuery<{ enabled: boolean }>({
    queryKey: ["portal-connect-status"],
    queryFn:  () => fetch("/api/portal/connect-status").then(response => response.json()),
  })

  // The portal API answers 404 for a hidden, deleted or unknown event alike, so every
  // failure lands on the same "no longer available" state.
  if (!isLoading && (isError || !evenement)) {
    return <DetailNotFound message={t("notFound")} backHref={listHref} backLabel={t("backToList")} />
  }

  return (
    <article className="max-w-3xl space-y-6">
      <BackLink href={listHref}>{t("backToList")}</BackLink>

      {isLoading || !evenement ? (
        <>
          <Skeleton className="aspect-video w-full rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="space-y-2">
            {LOADING_LINE_KEYS.map(lineKey => (
              <Skeleton key={lineKey} className="h-4 w-full" />
            ))}
          </div>
        </>
      ) : (
        <>
          {evenement.imageUrl && (
            // object-contain: portrait flyers are shown whole rather than cropped to 16:9.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={evenement.imageUrl} alt={evenement.title} className="aspect-video w-full rounded-lg border bg-muted object-contain" />
          )}

          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">{evenement.title}</h1>
            <EventMeta evenement={evenement} variant="detailed" />
          </div>

          {evenement.description && (
            <RichTextView content={evenement.description} className={DOCUMENT_PROSE} />
          )}

          {/* The participation controls are sized for the list card — keep them at a comparable
              width rather than stretching RSVP / ticket buttons across the whole column. */}
          <div className="border-t pt-6">
            <div className="max-w-md space-y-4">
              <EventParticipation
                evenement={evenement}
                isPast={isEvenementOver(evenement)}
                connectEnabled={connectData?.enabled ?? false}
                optimisticPaidId={null}
              />
            </div>
          </div>
        </>
      )}
    </article>
  )
}
