"use client"

import { useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { EnvelopeSimpleIcon, CircleNotchIcon, WarningCircleIcon, ArrowsClockwiseIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type EmailStatus = "QUEUED" | "SENT" | "DELIVERED" | "OPENED" | "CLICKED" | "BOUNCED" | "COMPLAINED" | "DELAYED" | "FAILED"

type EmailLogRow = {
  id:           string
  subject:      string
  source:       string
  status:       EmailStatus
  errorMessage: string | null
  to:           string
  sentAt:       string | null
  deliveredAt:  string | null
  openedAt:     string | null
  clickedAt:    string | null
  bouncedAt:    string | null
  complainedAt: string | null
  createdAt:    string
  hasAttachments: boolean
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

type TimelineKey = "createdAt" | "sentAt" | "deliveredAt" | "openedAt" | "clickedAt" | "bouncedAt" | "complainedAt"

const TIMELINE_STEPS: { key: TimelineKey; label: string; tone: "default" | "error" }[] = [
  { key: "createdAt",    label: "Créé",   tone: "default" },
  { key: "sentAt",       label: "Envoyé", tone: "default" },
  { key: "deliveredAt",  label: "Livré",  tone: "default" },
  { key: "openedAt",     label: "Ouvert", tone: "default" },
  { key: "clickedAt",    label: "Cliqué", tone: "default" },
  { key: "bouncedAt",    label: "Erreur", tone: "error"   },
  { key: "complainedAt", label: "Spam",   tone: "error"   },
]

function EmailLogItem({ e, membreId }: { e: EmailLogRow; membreId: string }) {
  const [open, setOpen] = useState(false)
  // Sorted by actual timestamp, not array position — webhook events (Resend) can land
  // out of the "expected" order (e.g. a delayed bounce recorded after delivery).
  const timeline = TIMELINE_STEPS
    .map(step => ({ label: step.label, tone: step.tone, at: e[step.key] }))
    .filter((step): step is { label: string; tone: "default" | "error"; at: string } => !!step.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  // Fetched only once the row is expanded — the list endpoint deliberately omits html
  // (can run several KB per row) since most rows in a page are never opened.
  const { data: content, isLoading: contentLoading, isError: contentError, refetch: refetchContent, isRefetching: contentRefetching } = useQuery<{ html: string | null }>({
    queryKey: ["membre-email-content", membreId, e.id],
    queryFn: async () => {
      const res = await fetch(`/api/membres/${membreId}/emails/${e.id}`)
      if (!res.ok) throw new Error()
      return res.json()
    },
    enabled:   open,
    staleTime: Infinity,
  })

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-left hover:bg-muted/30 transition-colors"
      >
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
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={STATUS_BADGE[e.status].variant}>{STATUS_BADGE[e.status].label}</Badge>
          <CaretDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="border-t px-3 py-3 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Destinataire</p>
            <p className="text-sm break-all">{e.to}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Suivi</p>
            <ol className="space-y-1">
              {timeline.map(step => (
                <li key={step.label} className="flex items-center gap-2 text-sm">
                  <span className={cn("size-1.5 rounded-full shrink-0", step.tone === "error" ? "bg-destructive" : "bg-emerald-500")} />
                  <span>{step.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(step.at), "d MMM yyyy, HH:mm", { locale: fr })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Contenu</p>
            {contentLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <CircleNotchIcon className="size-4 animate-spin" />
                Chargement…
              </div>
            )}
            {contentError && (
              <div className="flex items-center gap-2 text-sm text-destructive py-1">
                <span>Impossible de charger le contenu.</span>
                <Button size="sm" variant="outline" onClick={() => refetchContent()} disabled={contentRefetching} className="h-6 text-xs">
                  {contentRefetching ? <CircleNotchIcon className="size-3 animate-spin" /> : "Réessayer"}
                </Button>
              </div>
            )}
            {!contentLoading && !contentError && (
              content?.html ? (
                <>
                  <iframe
                    // Navigation/interactivity is already stripped server-side (see
                    // sanitizeEmailPreviewHtml in [emailId]/route.ts) — sandbox is defense
                    // in depth, not the primary mitigation. no-referrer keeps this admin's
                    // session/URL out of the Referer header on any image the email loads
                    // (e.g. a third-party pixel pasted into a bulk message body).
                    srcDoc={content.html}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    title={`Contenu de l'email : ${e.subject}`}
                    className="w-full h-96 rounded-md border bg-white"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Aperçu — les liens sont désactivés.
                    {e.hasAttachments && " Les pièces jointes ne sont pas affichées ici."}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground italic">Contenu non disponible pour cet envoi.</p>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
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
        {emails.map((e) => <EmailLogItem key={e.id} e={e} membreId={membreId} />)}
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
