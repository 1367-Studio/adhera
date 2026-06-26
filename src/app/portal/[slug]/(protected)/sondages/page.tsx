"use client"

import { useQuery } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { ClipboardListIcon, CheckCircleIcon, ClockIcon, ChevronRightIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type SondageItem = {
  id:             string
  title:          string
  description:    string | null
  deadline:       string | null
  anonymous:      boolean
  questionsCount: number
  repondu:        boolean
  submittedAt:    string | null
}

export default function SondagesPortalPage() {
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()

  const { data: sondages = [], isLoading } = useQuery<SondageItem[]>({
    queryKey: ["portal-sondages"],
    queryFn:  () => fetch("/api/portal/sondages").then(r => r.json()),
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Sondages</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Questionnaires à compléter de votre association.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map(i => (
            <div key={i} className="rounded-xl border p-4 animate-pulse space-y-2">
              <div className="h-5 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : sondages.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-2">
          <ClipboardListIcon className="size-10 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">Aucun sondage actif pour le moment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sondages.map(s => (
            <div
              key={s.id}
              onClick={() => !s.repondu && router.push(`/portal/${slug}/sondages/${s.id}`)}
              className={`rounded-xl border bg-card p-4 flex items-center gap-4 transition-colors ${
                s.repondu ? "opacity-70" : "cursor-pointer hover:border-ring"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm truncate">{s.title}</span>
                  {s.repondu ? (
                    <Badge variant="default" className="gap-1 shrink-0 bg-green-600/90 hover:bg-green-600">
                      <CheckCircleIcon className="size-3" />
                      Répondu
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1 shrink-0">
                      <ClockIcon className="size-3" />
                      À compléter
                    </Badge>
                  )}
                  {s.anonymous && (
                    <Badge variant="outline" className="text-xs shrink-0">Anonyme</Badge>
                  )}
                </div>
                {s.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{s.questionsCount} question{s.questionsCount !== 1 ? "s" : ""}</span>
                  {s.deadline && (
                    <span>Clôture : {format(new Date(s.deadline), "d MMM yyyy", { locale: fr })}</span>
                  )}
                  {s.repondu && s.submittedAt && (
                    <span>Complété le {format(new Date(s.submittedAt), "d MMM", { locale: fr })}</span>
                  )}
                </div>
              </div>

              {!s.repondu && (
                <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => router.push(`/portal/${slug}/sondages/${s.id}`)}>
                  Répondre
                  <ChevronRightIcon className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
