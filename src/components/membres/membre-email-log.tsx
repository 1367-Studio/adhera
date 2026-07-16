"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { EnvelopeSimpleIcon, CircleNotchIcon, WarningCircleIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type EmailStatus = "QUEUED" | "SENT" | "DELIVERED" | "OPENED" | "CLICKED" | "BOUNCED" | "COMPLAINED" | "DELAYED" | "FAILED"

type EmailLogRow = {
  id:           string
  subject:      string
  source:       string
  status:       EmailStatus
  errorMessage: string | null
  sentAt:       string | null
  openedAt:     string | null
  createdAt:    string
}

type PageResult = {
  data:       EmailLogRow[]
  total:      number
  page:       number
  totalPages: number
}

const STATUS_BADGE: Record<EmailStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  QUEUED:     { label: "En file",   variant: "outline"     },
  SENT:       { label: "Envoyé",    variant: "secondary"   },
  DELIVERED:  { label: "Livré",     variant: "secondary"   },
  OPENED:     { label: "Ouvert",    variant: "default"     },
  CLICKED:    { label: "Cliqué",    variant: "default"     },
  DELAYED:    { label: "Retardé",   variant: "outline"     },
  BOUNCED:    { label: "Erreur",    variant: "destructive" },
  COMPLAINED: { label: "Spam",      variant: "destructive" },
  FAILED:     { label: "Échec",     variant: "destructive" },
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

export function MembreEmailLog({ membreId }: { membreId: string }) {
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
  } = useInfiniteQuery<PageResult>({
    queryKey:        ["membre-emails", membreId],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/membres/${membreId}/emails?page=${pageParam}&pageSize=20`)
      if (!res.ok) throw new Error()
      return res.json()
    },
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  })

  const emails = data?.pages.flatMap(p => p.data) ?? []
  const total  = data?.pages[0]?.total ?? 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <CircleNotchIcon className="size-4 animate-spin mr-2" />
        <span className="text-sm">Chargement…</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <WarningCircleIcon className="size-4 shrink-0" />
        Impossible de charger l&apos;historique des e-mails.
      </div>
    )
  }

  const refreshButton = (
    <div className="flex justify-end">
      <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching} className="h-7 text-xs">
        <ArrowsClockwiseIcon className={`mr-1.5 size-3 ${isRefetching ? "animate-spin" : ""}`} />
        Actualiser
      </Button>
    </div>
  )

  if (emails.length === 0) {
    return (
      <div className="space-y-3">
        {refreshButton}
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aucun e-mail envoyé à ce membre.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {refreshButton}
      <div className="space-y-2">
        {emails.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm">
            <div className="flex items-start gap-2.5 min-w-0">
              <EnvelopeSimpleIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-medium truncate">{e.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {SOURCE_LABEL[e.source] ?? e.source} · {format(new Date(e.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
                </p>
                {e.errorMessage && <p className="text-xs text-destructive mt-0.5">{e.errorMessage}</p>}
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
  )
}
