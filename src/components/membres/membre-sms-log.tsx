"use client"

import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { DeviceMobileIcon, CircleNotchIcon, WarningCircleIcon, ArrowsClockwiseIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SmsStatus = "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "UNDELIVERED" | "FAILED"

type SmsLogRow = {
  id:           string
  body:         string
  to:           string
  source:       string
  status:       SmsStatus
  errorMessage: string | null
  sentAt:       string | null
  deliveredAt:  string | null
  failedAt:     string | null
  createdAt:    string
}

type PageResult = {
  data:       SmsLogRow[]
  total:      number
  page:       number
  totalPages: number
}

const STATUS_BADGE: Record<SmsStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  QUEUED:      { label: "En file",    variant: "outline"     },
  SENDING:     { label: "Envoi…",     variant: "outline"     },
  SENT:        { label: "Envoyé",     variant: "secondary"   },
  DELIVERED:   { label: "Livré",      variant: "default"     },
  UNDELIVERED: { label: "Non livré",  variant: "destructive" },
  FAILED:      { label: "Échec",      variant: "destructive" },
}

const SOURCE_LABEL: Record<string, string> = {
  BULK_MESSAGE:         "Message groupé",
  AUTOMATION:           "Automatisation",
  COTISATION_REMINDER:  "Rappel de cotisation",
}

type TimelineKey = "createdAt" | "sentAt" | "deliveredAt" | "failedAt"

const TIMELINE_STEPS: { key: TimelineKey; label: string; tone: "default" | "error" }[] = [
  { key: "createdAt",   label: "Créé",   tone: "default" },
  { key: "sentAt",      label: "Envoyé", tone: "default" },
  { key: "deliveredAt", label: "Livré",  tone: "default" },
  // failedAt's label is resolved per-row below instead of hardcoded here — it's shared by
  // both UNDELIVERED (Twilio tried, the carrier couldn't deliver) and FAILED (Twilio never
  // even attempted), which read the same in the timeline unless labeled from the row's own
  // final status.
  { key: "failedAt",    label: "Non livré", tone: "error" },
]

function SmsLogItem({ s }: { s: SmsLogRow }) {
  const [open, setOpen] = useState(false)
  // Sorted by actual timestamp, not array position — the Twilio status webhook can land
  // out of the "expected" order (e.g. a failure recorded after an earlier "sent" callback).
  const timeline = TIMELINE_STEPS
    .map(step => ({
      label: step.key === "failedAt" ? STATUS_BADGE[s.status].label : step.label,
      tone:  step.tone,
      at:    s[step.key],
    }))
    .filter((step): step is { label: string; tone: "default" | "error"; at: string } => !!step.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <DeviceMobileIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium truncate">{s.body}</p>
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABEL[s.source] ?? s.source} · {format(new Date(s.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
            </p>
            {s.errorMessage && <p className="text-xs text-destructive mt-0.5">{s.errorMessage}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={STATUS_BADGE[s.status].variant}>{STATUS_BADGE[s.status].label}</Badge>
          <CaretDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="border-t px-3 py-3 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Destinataire</p>
            <p className="text-sm break-all">{s.to}</p>
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
            <p className="text-xs text-muted-foreground mb-1">Message</p>
            <p className="text-sm whitespace-pre-wrap break-words">{s.body}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export function MembreSmsLog({ membreId }: { membreId: string }) {
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
    queryKey:        ["membre-sms", membreId],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/membres/${membreId}/sms?page=${pageParam}&pageSize=20`)
      if (!res.ok) throw new Error()
      return res.json()
    },
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  })

  const messages = data?.pages.flatMap(p => p.data) ?? []
  const total    = data?.pages[0]?.total ?? 0

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
        Impossible de charger l&apos;historique des SMS.
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

  if (messages.length === 0) {
    return (
      <div className="space-y-3">
        {refreshButton}
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aucun SMS envoyé à ce membre.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {refreshButton}
      <div className="space-y-2">
        {messages.map((s) => <SmsLogItem key={s.id} s={s} />)}
      </div>

      {(hasNextPage || messages.length < total) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>{messages.length} de {total} SMS</span>
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
