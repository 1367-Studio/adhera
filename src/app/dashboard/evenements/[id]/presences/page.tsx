"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { getPusherClient } from "@/lib/pusher-client"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { QRCodeSVG } from "qrcode.react"
import {
  ArrowLeftIcon, CheckIcon, ChevronDownIcon, DownloadIcon,
  QrCodeIcon, RefreshCwIcon, SearchIcon, UsersIcon, XIcon,
} from "lucide-react"
import { useEvenement, useParticipations, useTogglePresence, useGenerateQr, useRevokeQr } from "@/hooks/use-evenements"
import { useCurrentUser } from "@/lib/user-context"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

type PresenceRow = {
  membreId:  string
  firstName: string
  lastName:  string
  present:   boolean
  rsvp:      string | null
}

type Evenement = {
  id:          string
  title:       string
  date:        string
  capacity:    number | null
  qrToken:     string | null
  qrExpiresAt: string | null
}

const RSVP_LABELS: Record<string, { label: string; classes: string }> = {
  CONFIRME: { label: "J'y serai",    classes: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  PROVAVEL: { label: "Si possible",  classes: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  INCERTO:  { label: "Peut-être",    classes: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  ABSENT:   { label: "Absent",       classes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
}

export default function PresencesPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const qc      = useQueryClient()
  const user    = useCurrentUser()

  // Local QR state — initialized from server data, updated immediately after mutations
  const [qrToken, setQrToken]           = useState<string | null>(null)
  const [qrExpiresAt, setQrExpiresAt]   = useState<string | null>(null)
  const [pendingIds, setPendingIds]      = useState<Set<string>>(new Set())
  const [search, setSearch]             = useState("")
  const [revokeConfirmOpen,     setRevokeConfirmOpen]     = useState(false)
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false)

  const { data: evenement, isLoading: loadingEvent } = useEvenement(id)
  const ev = evenement as Evenement | undefined

  // Merge local state with server state (local takes precedence after mutations)
  const activeToken     = qrToken     ?? ev?.qrToken     ?? null
  const activeExpiresAt = qrExpiresAt ?? ev?.qrExpiresAt ?? null
  const activeExpired   = activeExpiresAt ? new Date(activeExpiresAt) < new Date() : false
  const activeQrValid   = !!(activeToken && !activeExpired)
  const checkInUrl      = activeToken && user.associationSlug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/check-in/${user.associationSlug}/${activeToken}`
    : ""

  // Real-time check-in updates via Pusher
  useEffect(() => {
    const channel = getPusherClient().subscribe(`event-${id}`)
    channel.bind("check-in", () => {
      qc.invalidateQueries({ queryKey: ["evenements", id, "participations"] })
    })
    return () => { getPusherClient().unsubscribe(`event-${id}`) }
  }, [id, qc])

  const { data: rows = [], isLoading: loadingRows } = useParticipations(id)

  const typed         = rows as PresenceRow[]
  const presentsCount = typed.filter(r => r.present).length

  const toggle     = useTogglePresence(id)
  const generateQr = useGenerateQr(id)
  const revokeQr   = useRevokeQr(id)

  const filtered = search.trim()
    ? typed.filter(r => `${r.lastName} ${r.firstName}`.toLowerCase().includes(search.toLowerCase()))
    : typed

  async function handleToggle(row: PresenceRow) {
    if (pendingIds.has(row.membreId)) return
    setPendingIds(prev => new Set(prev).add(row.membreId))
    try {
      await toggle.mutateAsync({ membreId: row.membreId, present: !row.present })
    } catch {
      toast.error("Erreur lors de la mise à jour")
    } finally {
      setPendingIds(prev => { const s = new Set(prev); s.delete(row.membreId); return s })
    }
  }

  async function handleGenerateQr() {
    try {
      const result = await generateQr.mutateAsync()
      setQrToken(result.qrToken)
      setQrExpiresAt(result.qrExpiresAt)
      toast.success("QR Code généré")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleRevokeQr() {
    try {
      await revokeQr.mutateAsync()
      setQrToken(null)
      setQrExpiresAt(null)
      toast.success("QR Code désactivé")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleExportPdf() {
    if (typed.length === 0) {
      toast.error("Aucun membre à exporter")
      return
    }
    const { default: jsPDF }     = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")
    const doc = new jsPDF()
    doc.setFontSize(14)
    doc.text(`Présences — ${ev?.title ?? ""}`, 14, 18)
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }), 14, 25)
    doc.setTextColor(0)
    autoTable(doc, {
      startY:       30,
      head:         [["#", "Membre", "Présent", "RSVP"]],
      body:         typed.map((r, i) => [i + 1, `${r.lastName} ${r.firstName}`, r.present ? "✓" : "", r.rsvp ? (RSVP_LABELS[r.rsvp]?.label ?? "") : ""]),
      headStyles:   { fillColor: [30, 30, 30] },
      columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 22, halign: "center" } },
      styles:       { fontSize: 9 },
    })
    doc.save(`presences_${(ev?.title ?? "export").replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`)
  }

  if (loadingEvent) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 rounded bg-muted animate-pulse" />
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
      </div>
    )
  }

  if (!ev) return null

  const capacity = ev.capacity
  const pct      = capacity ? Math.min(100, Math.round((presentsCount / capacity) * 100)) : null
  const isFull   = capacity != null && presentsCount >= capacity

  return (
    <div className="space-y-5 mt-4">
      {/* Back + export */}
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => router.push("/dashboard/evenements")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-4" />
          Événements
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
            <DownloadIcon className="mr-1.5 size-4" />
            Exporter
            <ChevronDownIcon className="ml-1 size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => window.location.href = `/api/evenements/${id}/export?format=csv`}>
              CSV (.csv)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.location.href = `/api/evenements/${id}/export?format=xlsx`}>
              Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportPdf}>
              PDF (.pdf)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Event header */}
      <div>
        <h1 className="text-xl font-semibold">{ev.title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {format(new Date(ev.date), "EEEE dd MMMM yyyy · HH:mm", { locale: fr })}
        </p>
      </div>

      {/* Counter */}
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <UsersIcon className="size-4 text-muted-foreground" />
            <span className="text-2xl font-bold">{presentsCount}</span>
            {capacity && (
              <span className="text-lg text-muted-foreground">/ {capacity}</span>
            )}
            <span className="text-sm text-muted-foreground">
              présent{presentsCount !== 1 ? "s" : ""}
            </span>
            {isFull && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                Complet
              </span>
            )}
          </div>
          {activeQrValid && (
            <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <span className="size-2 rounded-full bg-green-500 animate-pulse" />
              Check-in en cours · temps réel
            </span>
          )}
        </div>
        {pct !== null && (
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", isFull ? "bg-red-500" : "bg-green-500")}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>

      {/* Two columns: QR + List */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">

        {/* QR Panel */}
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <h2 className="text-sm font-semibold">QR Code de check-in</h2>

          {activeQrValid ? (
            <>
              <div className="flex justify-center">
                <div className="p-3 rounded-lg border bg-white">
                  <QRCodeSVG value={checkInUrl} size={180} />
                </div>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Expire le {format(new Date(activeExpiresAt!), "dd MMM · HH:mm", { locale: fr })}
              </p>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => { navigator.clipboard.writeText(checkInUrl); toast.success("Lien copié") }}
                >
                  Copier le lien
                </Button>
                <div className="flex gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger render={<span className="flex-1" />}>
                        <Button variant="outline" size="sm" className="w-full" onClick={() => setRegenerateConfirmOpen(true)} loading={generateQr.isPending}>
                          <RefreshCwIcon className="mr-1.5 size-3.5" />
                          Régénérer
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Invalide le QR actuel et génère un nouveau, valide 24h</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger render={<span />}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setRevokeConfirmOpen(true)}
                          loading={revokeQr.isPending}
                        >
                          <XIcon className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Désactiver le QR Code</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center space-y-3 py-4">
              <QrCodeIcon className="size-12 mx-auto text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                {activeToken && activeExpired ? "QR Code expiré." : "Aucun QR Code actif."}
              </p>
              <Button onClick={handleGenerateQr} loading={generateQr.isPending} className="w-full">
                <QrCodeIcon className="mr-1.5 size-4" />
                Générer un QR Code
              </Button>
            </div>
          )}
        </div>

        {/* Member list */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="p-3 border-b">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Rechercher un membre…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {loadingRows ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-11 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {search ? "Aucun résultat" : "Aucun membre actif"}
            </p>
          ) : (
            <div className="divide-y max-h-[60vh] overflow-y-auto">
              {filtered.map(row => (
                <button
                  key={row.membreId}
                  type="button"
                  onClick={() => handleToggle(row)}
                  disabled={pendingIds.has(row.membreId)}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors text-left",
                    row.present
                      ? "bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-950/50"
                      : "bg-background hover:bg-muted/50",
                  )}
                >
                  <span className={cn("font-medium", row.present && "text-green-700 dark:text-green-400")}>
                    {row.lastName} {row.firstName}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {row.rsvp && RSVP_LABELS[row.rsvp] && (
                      <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full hidden sm:inline", RSVP_LABELS[row.rsvp].classes)}>
                        {RSVP_LABELS[row.rsvp].label}
                      </span>
                    )}
                    <span className={cn(
                      "flex items-center justify-center size-6 rounded-full transition-colors shrink-0",
                      row.present
                        ? "bg-green-500 text-white"
                        : "border-2 border-muted-foreground/25",
                    )}>
                      {row.present && <CheckIcon className="size-3.5" />}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Revoke confirmation */}
      <ConfirmDialog
        open={revokeConfirmOpen}
        onOpenChange={setRevokeConfirmOpen}
        title="Désactiver le QR Code ?"
        description="Les membres ne pourront plus scanner ce code pour enregistrer leur présence. Les présences déjà enregistrées sont conservées."
        confirmLabel="Désactiver"
        loading={revokeQr.isPending}
        onConfirm={() => { setRevokeConfirmOpen(false); handleRevokeQr() }}
      />

      {/* Regenerate confirmation */}
      <ConfirmDialog
        open={regenerateConfirmOpen}
        onOpenChange={setRegenerateConfirmOpen}
        title="Régénérer le QR Code ?"
        description="Le QR Code actuel sera immédiatement invalidé. Toute personne qui essaie de scanner l'ancien code ne pourra plus s'enregistrer."
        confirmLabel="Régénérer"
        loading={generateQr.isPending}
        onConfirm={() => { setRegenerateConfirmOpen(false); handleGenerateQr() }}
      />
    </div>
  )
}
