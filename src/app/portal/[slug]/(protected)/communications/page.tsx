"use client"

import { useMemo, useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { EnvelopeSimpleIcon, CircleNotchIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { portalFetch } from "@/lib/portal-fetch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { sanitizeEmailPreviewHtml } from "@/lib/sanitize-email-preview"

type EmailStatus = "QUEUED" | "SENT" | "DELIVERED" | "OPENED" | "CLICKED" | "BOUNCED" | "COMPLAINED" | "DELAYED" | "FAILED"

type EmailRow = {
  id:           string
  subject:      string
  source:       string
  status:       EmailStatus
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
  // Kept distinct from BOUNCED/FAILED's "Erreur" — this is the member's own action
  // (they marked it as spam), not a delivery failure, and the expanded timeline below
  // already calls this same event "Spam"; matching the badge to it avoids showing two
  // different words for the same status.
  COMPLAINED: { label: "Spam",      variant: "destructive" },
  FAILED:     { label: "Erreur",    variant: "destructive" },
}

// Plain-language fallback shown under the timeline for failure statuses — BOUNCED and
// COMPLAINED usually have a matching timeline step, but FAILED has no dedicated timestamp
// in the schema at all, so without this a member sees a red "Erreur" badge and, on
// expanding, nothing more informative than "Créé" with no explanation of what happened.
const STATUS_NOTE: Partial<Record<EmailStatus, string>> = {
  BOUNCED:    "Cet e-mail n'a pas pu être livré (adresse invalide ou boîte pleine).",
  COMPLAINED: "Vous avez signalé cet e-mail comme indésirable.",
  FAILED:     "L'envoi de cet e-mail a échoué.",
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

function EmailRowItem({ e }: { e: EmailRow }) {
  const [open, setOpen] = useState(false)
  // Sorted by actual timestamp, not array position — webhook events (Resend) can land
  // out of the "expected" order (e.g. a delayed bounce recorded after delivery).
  const timeline = TIMELINE_STEPS
    .map(step => ({ label: step.label, tone: step.tone, at: e[step.key] }))
    .filter((step): step is { label: string; tone: "default" | "error"; at: string } => !!step.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  // Fetched only once the row is expanded — same reasoning as the admin's membre-email-log:
  // html can run several KB per row and most rows in a page are never opened.
  const { data: content, isLoading: contentLoading, isError: contentError, refetch: refetchContent, isRefetching: contentRefetching } = useQuery<{ html: string | null }>({
    queryKey: ["portal-email-content", e.id],
    queryFn:  () => portalFetch(`/api/portal/emails/${e.id}`) as Promise<{ html: string | null }>,
    enabled:   open,
    staleTime: Infinity,
  })

  const sanitizedHtml = useMemo(
    () => (content?.html ? sanitizeEmailPreviewHtml(content.html) : null),
    [content],
  )

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <EnvelopeSimpleIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium truncate">{e.subject}</p>
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABEL[e.source] ?? e.source} · {format(new Date(e.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={STATUS_BADGE[e.status].variant}>{STATUS_BADGE[e.status].label}</Badge>
          <CaretDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-3">
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
            {STATUS_NOTE[e.status] && (
              <p className="text-xs text-muted-foreground mt-1.5">{STATUS_NOTE[e.status]}</p>
            )}
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
              sanitizedHtml ? (
                <>
                  <iframe
                    // sandbox="" is defense in depth on top of sanitizeEmailPreviewHtml, not
                    // a substitute for it. no-referrer keeps this member's session/URL out of
                    // the Referer header on any image the email loads.
                    srcDoc={sanitizedHtml}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    title={`Contenu de l'email : ${e.subject}`}
                    // Shorter by default than the admin's equivalent (h-96) — this page is
                    // opened on phones far more than the admin dashboard is, and a fixed
                    // 24rem box creates an awkward scroll-inside-scroll on a small screen.
                    className="w-full h-72 sm:h-96 rounded-md border bg-white"
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
            {emails.map(e => <EmailRowItem key={e.id} e={e} />)}
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
