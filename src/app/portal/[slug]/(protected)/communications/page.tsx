"use client"

import { useMemo, useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { EnvelopeSimpleIcon, CircleNotchIcon, CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
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
  sourceId:     string | null
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

type TimelineKey = "createdAt" | "sentAt" | "deliveredAt" | "openedAt" | "clickedAt" | "bouncedAt" | "complainedAt"

function EmailRowItem({ e }: { e: EmailRow }) {
  const t        = useTranslations("portalMembre.communications")
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()
  const [open, setOpen] = useState(false)

  // The stored HTML preview below has all hrefs stripped by sanitizeEmailPreviewHtml (a
  // deliberate security measure — arbitrary stored email markup must never become a live,
  // clickable link in the portal), which silently kills the "Répondre au sondage" button
  // baked into that HTML. This CTA is the app-controlled replacement: it points straight at
  // the still-live sondage via sourceId rather than trusting anything from the email body.
  const sondageHref = e.source === "SONDAGE" && e.sourceId ? `/portal/${slug}/sondages/${e.sourceId}` : null

  const STATUS_BADGE: Record<EmailStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    QUEUED:     { label: t("statusBadge.queued"),     variant: "outline"     },
    SENT:       { label: t("statusBadge.sent"),       variant: "secondary"   },
    DELIVERED:  { label: t("statusBadge.delivered"),  variant: "secondary"   },
    OPENED:     { label: t("statusBadge.opened"),     variant: "default"     },
    CLICKED:    { label: t("statusBadge.clicked"),    variant: "default"     },
    DELAYED:    { label: t("statusBadge.delayed"),    variant: "outline"     },
    BOUNCED:    { label: t("statusBadge.bounced"),    variant: "destructive" },
    // Kept distinct from BOUNCED/FAILED's "Erreur" — this is the member's own action
    // (they marked it as spam), not a delivery failure, and the expanded timeline below
    // already calls this same event "Spam"; matching the badge to it avoids showing two
    // different words for the same status.
    COMPLAINED: { label: t("statusBadge.complained"), variant: "destructive" },
    FAILED:     { label: t("statusBadge.failed"),     variant: "destructive" },
  }

  // Plain-language fallback shown under the timeline for failure statuses — BOUNCED and
  // COMPLAINED usually have a matching timeline step, but FAILED has no dedicated timestamp
  // in the schema at all, so without this a member sees a red "Erreur" badge and, on
  // expanding, nothing more informative than "Créé" with no explanation of what happened.
  const STATUS_NOTE: Partial<Record<EmailStatus, string>> = {
    BOUNCED:    t("statusNote.bounced"),
    COMPLAINED: t("statusNote.complained"),
    FAILED:     t("statusNote.failed"),
  }

  const SOURCE_LABEL: Record<string, string> = {
    SONDAGE:        t("sourceLabel.sondage"),
    AUTOMATION:     t("sourceLabel.automation"),
    BULK_MESSAGE:   t("sourceLabel.bulkMessage"),
    MEMBER_INVITE:  t("sourceLabel.memberInvite"),
    MEETING_INVITE: t("sourceLabel.meetingInvite"),
    TRANSACTION:    t("sourceLabel.transaction"),
    DOCUMENT:       t("sourceLabel.document"),
    TEST:           t("sourceLabel.test"),
  }

  const TIMELINE_STEPS: { key: TimelineKey; label: string; tone: "default" | "error" }[] = [
    { key: "createdAt",    label: t("timeline.created"),    tone: "default" },
    { key: "sentAt",       label: t("timeline.sent"),       tone: "default" },
    { key: "deliveredAt",  label: t("timeline.delivered"),  tone: "default" },
    { key: "openedAt",     label: t("timeline.opened"),     tone: "default" },
    { key: "clickedAt",    label: t("timeline.clicked"),    tone: "default" },
    { key: "bouncedAt",    label: t("timeline.bounced"),    tone: "error"   },
    { key: "complainedAt", label: t("timeline.complained"), tone: "error"   },
  ]
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

  const sanitizedHtml = useMemo(() => {
    if (!content?.html) return null
    let raw = content.html
    if (sondageHref) {
      // When an app-controlled CTA (sondageHref) is already shown outside the iframe, remove
      // the matching button baked into the raw email HTML instead of leaving a dead, href-less
      // button that looks clickable but silently does nothing. Matched by href (which points at
      // this same sondage) rather than a marker class, so it also works for emails that were
      // sent and stored before any such marker existed.
      const doc  = new DOMParser().parseFromString(raw, "text/html")
      const dead = doc.querySelector(`a[href*="/sondages/${e.sourceId}"]`)
      dead?.closest("table")?.remove()
      raw = doc.documentElement.outerHTML
    }
    return sanitizeEmailPreviewHtml(raw)
  }, [content, sondageHref, e.sourceId])

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/30 transition-colors">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="flex items-start gap-2.5 min-w-0 flex-1 text-left"
        >
          <EnvelopeSimpleIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium truncate">{e.subject}</p>
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABEL[e.source] ?? e.source} · {format(new Date(e.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={STATUS_BADGE[e.status].variant}>{STATUS_BADGE[e.status].label}</Badge>
          {sondageHref && (
            // Label collapses to icon-only below sm: this row is one of the few with a
            // CTA long enough (badge + button text + caret) to squeeze the truncated
            // subject down to a few characters on a phone-width viewport, which this
            // page is opened on far more than the admin dashboard is.
            <Button
              size="sm"
              // orange-700 (not the -500 used for "incerto" status badges elsewhere) so
              // this reads as a solid CTA rather than the muted/pastel orange this app
              // otherwise uses for "pending/uncertain" — and it holds ~5:1 contrast with
              // white text, where -500 only manages ~2.8:1.
              className="h-7 text-xs gap-1 px-2 sm:px-2.5 bg-orange-700 text-white hover:bg-orange-800"
              aria-label={t("openSondage")}
              onClick={() => router.push(sondageHref)}
            >
              <span className="hidden sm:inline">{t("openSondage")}</span>
              <CaretRightIcon className="size-3.5" />
            </Button>
          )}
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-label={t("content")}
            className="p-2 -m-2 rounded-md hover:bg-muted/50"
          >
            <CaretDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

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
            <div key={i} className="rounded-lg border p-4 animate-pulse space-y-2">
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : emails.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center space-y-2">
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
