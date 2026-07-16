"use client"

import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { EnvelopeSimpleIcon, CheckCircleIcon, EyeIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge"

type EmailStatus = "QUEUED" | "SENT" | "DELIVERED" | "OPENED" | "CLICKED" | "BOUNCED" | "COMPLAINED" | "DELAYED" | "FAILED"

type Recipient = {
  membreId:     string | null
  name:         string | null
  to:           string
  status:       EmailStatus
  errorMessage: string | null
  sentAt:       string | null
  openedAt:     string | null
  bouncedAt:    string | null
}

type EmailStatsData = {
  total:           number
  counts:          Record<EmailStatus, number>
  recipients:      Recipient[]
  skippedNoEmail:  { id: string; name: string }[]
  skippedNoAccess: number
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

const ERROR_STATUSES: EmailStatus[] = ["BOUNCED", "COMPLAINED", "FAILED"]

interface SondageEmailStatsProps {
  data: EmailStatsData
}

export function SondageEmailStats({ data }: SondageEmailStatsProps) {
  const skippedTotal = data.skippedNoEmail.length + data.skippedNoAccess

  const skippedBanner = skippedTotal > 0 && (
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 flex gap-3">
      <WarningCircleIcon className="size-5 shrink-0 text-amber-600 mt-0.5" />
      <div className="space-y-1 text-sm">
        <p className="font-medium text-amber-800 dark:text-amber-300">
          {skippedTotal} destinataire{skippedTotal > 1 ? "s" : ""} n&apos;{skippedTotal > 1 ? "ont" : "a"} reçu aucune invitation
        </p>
        <div className="text-amber-700 dark:text-amber-400 space-y-0.5">
          {data.skippedNoEmail.length > 0 && (
            <p>
              {data.skippedNoEmail.length} sans adresse e-mail : {data.skippedNoEmail.map(m => m.name).join(", ")}
            </p>
          )}
          {data.skippedNoAccess > 0 && (
            <p>{data.skippedNoAccess} sans accès au portail (aucun compte membre)</p>
          )}
        </div>
      </div>
    </div>
  )

  if (data.total === 0) {
    return (
      <div className="space-y-4">
        {skippedBanner}
        <div className="rounded-xl border border-dashed p-12 text-center space-y-2">
          <EnvelopeSimpleIcon className="size-10 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">Aucun e-mail envoyé pour ce sondage.</p>
        </div>
      </div>
    )
  }

  const opened  = data.counts.OPENED + data.counts.CLICKED
  const errors  = ERROR_STATUSES.reduce((s, k) => s + data.counts[k], 0)
  const delivered = data.counts.DELIVERED + opened

  return (
    <div className="space-y-4">
      {skippedBanner}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><EnvelopeSimpleIcon className="size-3.5" />Envoyés</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums">{data.total}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircleIcon className="size-3.5" />Livrés</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums">{delivered}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><EyeIcon className="size-3.5" />Ouverts</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums">{opened}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{data.total ? Math.round(opened / data.total * 100) : 0}% de taux d&apos;ouverture</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><WarningCircleIcon className="size-3.5" />Erreurs</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums">{errors}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="divide-y">
          {data.recipients.map((r, i) => (
            <div key={r.membreId ?? i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{r.name ?? r.to}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {r.to}
                  {r.errorMessage && <span className="text-destructive"> — {r.errorMessage}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.sentAt && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {format(new Date(r.sentAt), "d MMM, HH:mm", { locale: fr })}
                  </span>
                )}
                <Badge variant={STATUS_BADGE[r.status].variant}>{STATUS_BADGE[r.status].label}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
