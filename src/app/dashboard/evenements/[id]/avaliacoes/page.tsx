"use client"

import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useEvenement } from "@/hooks/use-evenements"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { StarRatingDisplay } from "@/components/ui/star-rating"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Evenement = {
  id:    string
  title: string
  date:  string
}

type AvisRow = {
  id:        string
  firstName: string
  lastName:  string
  rating:    number
  comment:   string | null
  createdAt: string
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

  const { data: evenement, isLoading: loadingEvent } = useEvenement(id)
  const ev = evenement as Evenement | undefined

  const { data } = useQuery({
    queryKey: ["evenements", id, "avaliacoes"],
    queryFn:  () => fetchAvaliacoes(id),
    enabled:  !!id,
  })

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

  return (
    <div className="space-y-5 mt-4">
      <BackLink href="/dashboard/evenements">{t("evenements.view.title")}</BackLink>

      <div>
        <h1 className="text-xl font-semibold">{ev.title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {format(new Date(ev.date), "EEEE dd MMMM yyyy · HH:mm", { locale: fr })}
        </p>
      </div>

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

      {avis.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
              <TableHead>{t("evenements.avaliacoes.columns.participant")}</TableHead>
              <TableHead>{t("evenements.avaliacoes.columns.rating")}</TableHead>
              <TableHead>{t("evenements.avaliacoes.columns.comment")}</TableHead>
              <TableHead className="text-right">{t("evenements.avaliacoes.columns.date")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {avis.map(a => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.firstName} {a.lastName}</TableCell>
                <TableCell><StarRatingDisplay value={a.rating} /></TableCell>
                <TableCell className="text-muted-foreground max-w-md">{a.comment ?? "—"}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {format(new Date(a.createdAt), "dd MMM yyyy", { locale: fr })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
