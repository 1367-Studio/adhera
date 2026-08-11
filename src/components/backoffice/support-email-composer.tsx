"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { CircleNotchIcon, CaretDownIcon, WarningCircleIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { FormField } from "@/components/ui/form-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { cn } from "@/lib/utils"

const HISTORY_PAGE_SIZE = 20

type Manager = { id: string; name: string | null; email: string; role: string }
type Membre  = { id: string; firstName: string; lastName: string; email: string | null; status: string }

type HistoryRow = {
  id: string
  subject: string
  to: string
  status: string
  errorMessage: string | null
  sentAt: string | null
  deliveredAt: string | null
  openedAt: string | null
  clickedAt: string | null
  bouncedAt: string | null
  complainedAt: string | null
  createdAt: string
  userId: string | null
  membreId: string | null
  user: { name: string | null; email: string; role: string } | null
  membre: { firstName: string; lastName: string } | null
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

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
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

export function SupportEmailComposer({ associationId }: { associationId: string }) {
  const [managers, setManagers] = useState<Manager[]>([])
  const [membres,  setMembres]  = useState<Membre[]>([])
  const [loadingLists, setLoadingLists] = useState(true)
  const [listsError,   setListsError]   = useState(false)

  const [history,       setHistory]       = useState<HistoryRow[]>([])
  const [historyTotal,  setHistoryTotal]  = useState(0)
  const [historyPage,   setHistoryPage]   = useState(1)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)
  const [historyError,  setHistoryError]  = useState(false)

  const [managerIds, setManagerIds] = useState<Set<string>>(new Set())
  const [membreIds,  setMembreIds]  = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState("")
  const [bodyHtml, setBodyHtml] = useState("")
  const [pending, startTransition] = useTransition()

  const loadLists = useCallback(() => {
    setListsError(false)
    setLoadingLists(true)
    Promise.all([
      fetch(`/api/backoffice/associations/${associationId}/managers`),
      fetch(`/api/backoffice/associations/${associationId}/members`),
    ])
      .then(async ([managersRes, membresRes]) => {
        if (!managersRes.ok || !membresRes.ok) throw new Error()
        setManagers(await managersRes.json())
        setMembres(await membresRes.json())
      })
      .catch(() => setListsError(true))
      .finally(() => setLoadingLists(false))
  }, [associationId])

  const loadHistory = useCallback((page: number, append: boolean) => {
    setHistoryError(false)
    if (append) setHistoryLoadingMore(true)
    else setHistoryLoading(true)
    fetch(`/api/backoffice/associations/${associationId}/support-email?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`)
      .then(res => { if (!res.ok) throw new Error(); return res.json() })
      .then(({ emails, total }) => {
        setHistory(prev => append ? [...prev, ...emails] : emails)
        setHistoryTotal(total)
        setHistoryPage(page)
      })
      .catch(() => setHistoryError(true))
      .finally(() => { setHistoryLoading(false); setHistoryLoadingMore(false) })
  }, [associationId])

  useEffect(() => { loadLists() }, [loadLists])
  useEffect(() => { loadHistory(1, false) }, [loadHistory])

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSet(next)
  }

  function send() {
    if (!subject.trim() || !bodyHtml.trim()) return
    if (managerIds.size === 0 && membreIds.size === 0) {
      toast.error("Sélectionnez au moins un destinataire")
      return
    }
    startTransition(async () => {
      const res = await fetch(`/api/backoffice/associations/${associationId}/support-email`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject:    subject.trim(),
          bodyHtml:   bodyHtml.trim(),
          managerIds: Array.from(managerIds),
          membreIds:  Array.from(membreIds),
        }),
      })
      if (res.ok) {
        const { sent, failed, failedRecipients } = await res.json()
        if (failed) {
          toast.error(`${sent} envoyé(s), ${failed} échec(s)`, {
            description: failedRecipients?.length ? `Échec pour : ${failedRecipients.join(", ")}` : undefined,
          })
        } else {
          toast.success(`${sent} email(s) envoyé(s)`)
        }
        setSubject("")
        setBodyHtml("")
        setManagerIds(new Set())
        setMembreIds(new Set())
        loadHistory(1, false)
      } else {
        const { error } = await res.json().catch(() => ({ error: null }))
        toast.error(error ?? "Erreur lors de l'envoi")
      }
    })
  }

  if (loadingLists) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <CircleNotchIcon className="size-4 animate-spin" />
        Chargement…
      </div>
    )
  }

  if (listsError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <WarningCircleIcon className="size-4 shrink-0" />
        Impossible de charger les destinataires.
        <Button size="sm" variant="outline" onClick={loadLists} className="ml-auto h-7 text-xs">
          Réessayer
        </Button>
      </div>
    )
  }

  const selectedCount = managerIds.size + membreIds.size

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Gestionnaires</p>
          {managers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun gestionnaire.</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {managers.map(m => (
                <CheckboxField
                  key={m.id}
                  label={<span className="truncate block">{m.name ?? m.email} · {m.role}</span>}
                  checked={managerIds.has(m.id)}
                  onChange={() => toggle(managerIds, setManagerIds, m.id)}
                  disabled={pending}
                />
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Membres</p>
          {membres.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun membre.</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {membres.filter(m => m.email).map(m => (
                <CheckboxField
                  key={m.id}
                  label={<span className="truncate block">{m.firstName} {m.lastName}</span>}
                  checked={membreIds.has(m.id)}
                  onChange={() => toggle(membreIds, setMembreIds, m.id)}
                  disabled={pending}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <FormField
        label="Objet"
        value={subject}
        onChange={e => setSubject(e.target.value)}
        maxLength={200}
        disabled={pending}
      />
      <TextareaField
        label="Message"
        rows={6}
        value={bodyHtml}
        onChange={e => setBodyHtml(e.target.value)}
        disabled={pending}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {selectedCount} destinataire{selectedCount !== 1 ? "s" : ""} sélectionné{selectedCount !== 1 ? "s" : ""}
        </span>
        <Button
          size="sm"
          onClick={send}
          loading={pending}
          disabled={pending || !subject.trim() || !bodyHtml.trim() || selectedCount === 0}
        >
          Envoyer
        </Button>
      </div>

      <div className="space-y-2 pt-2 border-t">
        <div className="flex items-center justify-between pt-3">
          <p className="text-xs font-medium text-muted-foreground">Historique</p>
          <Button size="sm" variant="outline" onClick={() => loadHistory(1, false)} className="h-7 text-xs">
            <ArrowsClockwiseIcon className="mr-1.5 size-3" />
            Actualiser
          </Button>
        </div>

        {historyLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <CircleNotchIcon className="size-4 animate-spin" />
            Chargement…
          </div>
        ) : historyError ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <WarningCircleIcon className="size-4 shrink-0" />
            Impossible de charger l&apos;historique.
            <Button size="sm" variant="outline" onClick={() => loadHistory(1, false)} className="ml-auto h-7 text-xs">
              Réessayer
            </Button>
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun email envoyé pour l&apos;instant.</p>
        ) : (
          <>
            <div className="space-y-1.5">
              {history.map(h => <HistoryItem key={h.id} row={h} />)}
            </div>
            {history.length < historyTotal && (
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>{history.length} sur {historyTotal}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => loadHistory(historyPage + 1, true)}
                  disabled={historyLoadingMore}
                  className="h-7 text-xs"
                >
                  {historyLoadingMore ? <CircleNotchIcon className="size-3 animate-spin" /> : "Voir plus"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function HistoryItem({ row }: { row: HistoryRow }) {
  const [open, setOpen] = useState(false)
  const recipient = row.user
    ? `${row.user.name ?? row.user.email} · ${row.user.role}`
    : row.membre
      ? `${row.membre.firstName} ${row.membre.lastName}`
      : row.to
  const status = STATUS_LABEL[row.status] ?? { label: row.status, variant: "outline" as const }

  // Sorted by actual timestamp, not array position — webhook events (Resend) can land out
  // of the "expected" order (e.g. a delayed bounce recorded after delivery).
  const timeline = TIMELINE_STEPS
    .map(step => ({ label: step.label, tone: step.tone, at: row[step.key] }))
    .filter((step): step is { label: string; tone: "default" | "error"; at: string } => !!step.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-muted/30 transition-colors"
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{row.subject}</p>
          <p className="text-xs text-muted-foreground truncate">
            {recipient} · {format(new Date(row.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={status.variant}>{status.label}</Badge>
          <CaretDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-2">
          <p className="text-xs text-muted-foreground">Destinataire : {row.to}</p>
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
          {row.errorMessage && <p className="text-xs text-destructive">{row.errorMessage}</p>}
        </div>
      )}
    </div>
  )
}
