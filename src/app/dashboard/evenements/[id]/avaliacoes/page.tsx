"use client"

import { useEffect } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useEvenement } from "@/hooks/use-evenements"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { StarRatingDisplay } from "@/components/ui/star-rating"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Evenement = {
  id:    string
  title: string
  date:  string
}

type AvisRow = {
  id:                  string
  firstName:           string
  lastName:            string
  rating:              number
  comment:             string | null
  createdAt:           string
  publicationAgreedAt: string | null
  anonymous:           boolean
  featuredOnSite:      boolean
}

type AvaliacoesResponse = {
  average: number | null
  count:   number
  avis:    AvisRow[]
}

async function fetchAvaliacoes(evenementId: string): Promise<AvaliacoesResponse> {
  const res = await fetch(`/api/evenements/${evenementId}/avaliacoes`)
  if (!res.ok) throw new Error("Erreur")
  return res.json()
}

export default function AvaliacoesPage() {
  const t      = useTranslations()
  const { id } = useParams<{ id: string }>()
  const qc     = useQueryClient()

  const { data: evenement, isLoading: loadingEvent } = useEvenement(id)
  const ev = evenement as Evenement | undefined

  const { data } = useQuery({
    queryKey: ["evenements", id, "avaliacoes"],
    queryFn:  () => fetchAvaliacoes(id),
    enabled:  !!id,
  })

  const featureMutation = useMutation({
    mutationFn: async ({ avisId, featuredOnSite }: { avisId: string; featuredOnSite: boolean }) => {
      const res = await fetch(`/api/evenements/${id}/avaliacoes/${avisId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ featuredOnSite }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("common.genericError"))
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evenements", id, "avaliacoes"] }),
    onError:   (error: Error) => toast.error(error.message),
  })

  // Toggles every consented row at once — an event with many positive reviews shouldn't need
  // one click each. Only touches rows that actually need to change.
  const bulkFeatureMutation = useMutation({
    mutationFn: async (featuredOnSite: boolean) => {
      const toChange = (data?.avis ?? []).filter(a => a.publicationAgreedAt && a.featuredOnSite !== featuredOnSite)
      await Promise.all(toChange.map(async a => {
        const res = await fetch(`/api/evenements/${id}/avaliacoes/${a.id}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ featuredOnSite }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? t("common.genericError"))
      }))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evenements", id, "avaliacoes"] }),
    onError:   (error: Error) => toast.error(error.message),
  })

  // « Voir l'avis » on the bilan page links to #avis-<id>: the rows only exist once the
  // reviews have loaded, after the browser's own hash scroll already gave up.
  useEffect(() => {
    if (!data) return
    const anchorId = window.location.hash.slice(1)
    if (anchorId) document.getElementById(anchorId)?.scrollIntoView({ block: "center" })
  }, [data])

  if (loadingEvent) {
    return <DetailLoadingSkeleton />
  }

  if (!ev) {
    return (
      <DetailNotFound
        message={t("evenements.presences.notFound.message")}
        backHref="/dashboard/evenements"
        backLabel={t("evenements.presences.notFound.backLabel")}
      />
    )
  }

  const avis = data?.avis ?? []
  const eligibleForSite = avis.filter(a => a.publicationAgreedAt)
  const allEligibleFeatured = eligibleForSite.length > 0 && eligibleForSite.every(a => a.featuredOnSite)

  return (
    <div className="space-y-5 mt-4">
      <BackLink href="/dashboard/evenements">{t("evenements.view.title")}</BackLink>

      <div>
        <h1 className="text-xl font-semibold">{ev.title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {format(new Date(ev.date), "EEEE dd MMMM yyyy · HH:mm", { locale: fr })}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          {data?.average != null ? (
            <>
              <StarRatingDisplay value={data.average} />
              <span className="font-medium">{data.average.toFixed(1)} / 5</span>
              <span className="text-muted-foreground">
                · {t("evenements.avaliacoes.countLabel", { count: data.count })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t("evenements.avaliacoes.empty")}</span>
          )}
        </div>
        {eligibleForSite.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            loading={bulkFeatureMutation.isPending}
            onClick={() => bulkFeatureMutation.mutate(!allEligibleFeatured)}
          >
            {allEligibleFeatured ? t("evenements.avaliacoes.bulkUnfeatureAll") : t("evenements.avaliacoes.bulkFeatureAll")}
          </Button>
        )}
      </div>

      {avis.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
              <TableHead>{t("evenements.avaliacoes.columns.participant")}</TableHead>
              <TableHead>{t("evenements.avaliacoes.columns.rating")}</TableHead>
              <TableHead>{t("evenements.avaliacoes.columns.comment")}</TableHead>
              <TableHead>{t("evenements.avaliacoes.columns.date")}</TableHead>
              <TableHead className="text-right">{t("evenements.avaliacoes.columns.site")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {avis.map(a => (
              <TableRow key={a.id} id={`avis-${a.id}`}>
                <TableCell className="font-medium">{a.firstName} {a.lastName}</TableCell>
                <TableCell><StarRatingDisplay value={a.rating} /></TableCell>
                <TableCell className="text-muted-foreground max-w-md">
                  <div className="flex flex-col gap-0.5">
                    <span>{a.comment ?? "—"}</span>
                    {a.anonymous && a.publicationAgreedAt && (
                      <span className="text-xs">({t("evenements.avaliacoes.anonymousNote")})</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(a.createdAt), "dd MMM yyyy", { locale: fr })}
                </TableCell>
                <TableCell className="text-right">
                  {a.publicationAgreedAt ? (
                    <Switch
                      aria-label={t("evenements.avaliacoes.featureToggleLabel", { name: `${a.firstName} ${a.lastName}` })}
                      checked={a.featuredOnSite}
                      disabled={(featureMutation.isPending && featureMutation.variables?.avisId === a.id) || bulkFeatureMutation.isPending}
                      onCheckedChange={checked => featureMutation.mutate({ avisId: a.id, featuredOnSite: checked })}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("evenements.avaliacoes.noConsent")}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
