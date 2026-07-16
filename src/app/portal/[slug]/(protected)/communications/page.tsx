"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { EnvelopeSimpleIcon, CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
import { portalFetch } from "@/lib/portal-fetch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type EmailStatus = "QUEUED" | "SENT" | "DELIVERED" | "OPENED" | "CLICKED" | "BOUNCED" | "COMPLAINED" | "DELAYED" | "FAILED"

type EmailRow = {
  id:        string
  subject:   string
  source:    string
  status:    EmailStatus
  sentAt:    string | null
  openedAt:  string | null
  createdAt: string
}

type PageResult = {
  data:       EmailRow[]
  total:      number
  page:       number
  totalPages: number
}

const STATUS_BADGE: Record<EmailStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  QUEUED:     { label: "En file",   variant: "outline"     },
  SENT:       { label: "Envoyé",    variant: "secondary"   },
  DELIVERED:  { label: "Livré",     variant: "secondary"   },
  OPENED:     { label: "Ouvert",    variant: "default"     },
  CLICKED:    { label: "Ouvert",    variant: "default"     },
  DELAYED:    { label: "En cours",  variant: "outline"     },
  BOUNCED:    { label: "Erreur",    variant: "destructive" },
  COMPLAINED: { label: "Erreur",    variant: "destructive" },
  FAILED:     { label: "Erreur",    variant: "destructive" },
}

const SOURCE_LABEL: Record<string, string> = {
  SONDAGE:        "Sondage",
  AUTOMATION:     "Automatisation",
  BULK_MESSAGE:   "Message groupé",
  MEMBER_INVITE:  "Invitation",
  MEETING_INVITE: "Réunion",
  TRANSACTION:    "Confirmation",
  DOCUMENT:       "Document",
  TEST:           "Test",
}

export default function CommunicationsPortalPage() {
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PageResult>({
    queryKey:        ["portal-emails"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => portalFetch(`/api/portal/emails?page=${pageParam}&pageSize=20`) as Promise<PageResult>,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    staleTime: 0,
  })

  const emails = data?.pages.flatMap(p => p.data) ?? []
  const total  = data?.pages[0]?.total ?? 0

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Mes communications</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Les e-mails que votre association vous a envoyés.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl border p-4 animate-pulse space-y-2">
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : emails.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-2">
          <EnvelopeSimpleIcon className="size-10 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">Aucun e-mail reçu pour le moment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            {emails.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
                <div className="flex items-start gap-2.5 min-w-0">
                  <EnvelopeSimpleIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{e.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[e.source] ?? e.source} · {format(new Date(e.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
                    </p>
                  </div>
                </div>
                <Badge variant={STATUS_BADGE[e.status].variant} className="shrink-0">{STATUS_BADGE[e.status].label}</Badge>
              </div>
            ))}
          </div>

          {(hasNextPage || emails.length < total) && (
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
              <span>{emails.length} de {total} e-mail{total !== 1 ? "s" : ""}</span>
              {hasNextPage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="h-7 text-xs"
                >
                  {isFetchingNextPage ? (
                    <><CircleNotchIcon className="size-3 animate-spin mr-1.5" />Chargement…</>
                  ) : (
                    "Voir plus"
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
