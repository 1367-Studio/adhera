"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { getPusherClient } from "@/lib/pusher-client"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { QRCodeSVG } from "qrcode.react"
import { ArrowLeftIcon, MoneyIcon, BookmarkSimpleIcon, CheckIcon, CaretDownIcon, DownloadSimpleIcon, InfoIcon, PencilSimpleIcon, QrCodeIcon, ArrowsClockwiseIcon, MagnifyingGlassIcon, TrashIcon, UserPlusIcon, UsersIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useEvenement, useParticipations, useTogglePresence, useGenerateQr, useRevokeQr, useMarkPaid, useCancelPayment,
  useAddGuest, useEditGuest, useDeleteGuest, type RowRef,
} from "@/hooks/use-evenements"
import { useCurrentUser } from "@/lib/user-context"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { APP_NAME } from "@/config/brand"
import { Modal } from "@/components/ui/modal"
import { cn } from "@/lib/utils"

type PresenceRow = {
  membreId:        string | null
  firstName:       string
  lastName:        string
  email:           string | null
  participationId: string | null
  present:         boolean
  rsvp:            string | null
  ticketPaidAt:    string | null
  stripeSessionId: string | null
  isGuest:         boolean
}

function rowRef(row: PresenceRow): RowRef {
  return row.participationId ? { participationId: row.participationId } : { membreId: row.membreId! }
}

function rowKey(row: PresenceRow): string {
  return row.participationId ?? row.membreId!
}

type Evenement = {
  id:          string
  title:       string
  date:        string
  endDate:     string | null
  location:    string | null
  price:       string | null
  capacity:    number | null
  qrToken:     string | null
  qrExpiresAt: string | null
}

// Mirrors the grace window enforced server-side in /api/portal/check-in/[token] —
// self check-in is only accepted from 3h before the event start to 6h after it ends
// (or start + 24h if no end date is set), so a still-valid QR can't be used off-day.
const CHECKIN_GRACE_BEFORE_MS = 3 * 3_600_000
const CHECKIN_GRACE_AFTER_MS  = 6 * 3_600_000

function getCheckInWindow(ev: Evenement) {
  const start = new Date(ev.date)
  const end   = ev.endDate ? new Date(ev.endDate) : new Date(start.getTime() + 24 * 3_600_000)
  return {
    opensAt:  new Date(start.getTime() - CHECKIN_GRACE_BEFORE_MS),
    closesAt: new Date(end.getTime() + CHECKIN_GRACE_AFTER_MS),
  }
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
  const [payingIds, setPayingIds]        = useState<Set<string>>(new Set())
  const [cancelPayIds, setCancelPayIds]   = useState<Set<string>>(new Set())
  const [search, setSearch]             = useState("")
  const [revokeConfirmOpen,     setRevokeConfirmOpen]     = useState(false)
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false)
  const [addGuestOpen, setAddGuestOpen] = useState(false)
  const [guestFirstName, setGuestFirstName] = useState("")
  const [guestLastName,  setGuestLastName]  = useState("")
  const [guestEmail,     setGuestEmail]     = useState("")
  const [editTarget, setEditTarget]     = useState<PresenceRow | null>(null)
  const [editFirstName, setEditFirstName] = useState("")
  const [editLastName,  setEditLastName]  = useState("")
  const [editEmail,     setEditEmail]     = useState("")
  const [deleteTarget, setDeleteTarget] = useState<PresenceRow | null>(null)

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
    const pusher = getPusherClient()
    if (!pusher) return
    const channel = pusher.subscribe(`event-${id}`)
    channel.bind("check-in", () => {
      qc.invalidateQueries({ queryKey: ["evenements", id, "participations"] })
    })
    return () => { pusher.unsubscribe(`event-${id}`) }
  }, [id, qc])

  // Re-render every minute so the check-in window banner updates on its own —
  // this page is typically left open at the door for the whole event.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => forceTick(t => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [])

  const { data: rows = [], isLoading: loadingRows } = useParticipations(id)

  const typed          = rows as PresenceRow[]
  const hasFee         = !!ev?.price && Number(ev.price) > 0
  const presentsCount  = typed.filter(r => r.present).length
  const reservedCount  = hasFee
    ? typed.filter(r => r.ticketPaidAt != null || r.rsvp === "CONFIRME").length
    : 0

  const toggle     = useTogglePresence(id)
  const markPaid    = useMarkPaid(id)
  const cancelPaid  = useCancelPayment(id)
  const addGuest    = useAddGuest(id)
  const editGuest   = useEditGuest(id)
  const deleteGuest = useDeleteGuest(id)
  const generateQr  = useGenerateQr(id)
  const revokeQr    = useRevokeQr(id)

  const filtered = search.trim()
    ? typed.filter(r => `${r.lastName} ${r.firstName}`.toLowerCase().includes(search.toLowerCase()))
    : typed

  function handleMarkPaid(row: PresenceRow) {
    const key = rowKey(row)
    if (payingIds.has(key)) return
    setPayingIds(prev => new Set(prev).add(key))
    markPaid.mutate(rowRef(row), {
      onSuccess: () => toast.success(`${row.firstName} ${row.lastName} marqué comme payé`),
      onError:   (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
      onSettled: () => setPayingIds(prev => { const s = new Set(prev); s.delete(key); return s }),
    })
  }

  function handleCancelPayment(row: PresenceRow) {
    const key = rowKey(row)
    if (cancelPayIds.has(key)) return
    setCancelPayIds(prev => new Set(prev).add(key))
    cancelPaid.mutate(rowRef(row), {
      onSuccess: () => toast.success(`Paiement de ${row.firstName} ${row.lastName} annulé`),
      onError:   (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
      onSettled: () => setCancelPayIds(prev => { const s = new Set(prev); s.delete(key); return s }),
    })
  }

  async function handleAddGuest() {
    if (!guestFirstName.trim() || !guestLastName.trim()) return
    try {
      await addGuest.mutateAsync({ firstName: guestFirstName.trim(), lastName: guestLastName.trim(), email: guestEmail.trim() || undefined })
      toast.success(`${guestFirstName} ${guestLastName} ajouté·e et marqué·e présent·e`)
      setAddGuestOpen(false)
      setGuestFirstName(""); setGuestLastName(""); setGuestEmail("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  function openEdit(row: PresenceRow) {
    setEditTarget(row)
    setEditFirstName(row.firstName)
    setEditLastName(row.lastName)
    setEditEmail(row.email ?? "")
  }

  async function handleEditGuest() {
    if (!editTarget || !editFirstName.trim() || !editLastName.trim()) return
    try {
      await editGuest.mutateAsync({
        participationId: editTarget.participationId!,
        firstName: editFirstName.trim(), lastName: editLastName.trim(), email: editEmail.trim() || undefined,
      })
      toast.success("Invité·e mis·e à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDeleteGuest() {
    if (!deleteTarget) return
    try {
      await deleteGuest.mutateAsync(deleteTarget.participationId!)
      toast.success(`${deleteTarget.firstName} ${deleteTarget.lastName} retiré·e de la liste`)
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
      setDeleteTarget(null)
    }
  }

  async function handleToggle(row: PresenceRow) {
    const key = rowKey(row)
    if (pendingIds.has(key)) return
    setPendingIds(prev => new Set(prev).add(key))
    try {
      await toggle.mutateAsync({ ...rowRef(row), present: !row.present })
    } catch {
      toast.error("Erreur lors de la mise à jour")
    } finally {
      setPendingIds(prev => { const s = new Set(prev); s.delete(key); return s })
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

    const doc   = new jsPDF({ unit: "mm", format: "a4" })
    const W     = 210
    const M     = 14
    const ZINC  = [113, 113, 122] as [number, number, number]
    const BLACK = [24,  24,  27 ] as [number, number, number]
    const title = ev?.title ?? ""
    const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })

    // ── Header bar ─────────────────────────────────────────────────────────
    doc.setFillColor(0, 0, 0)
    doc.rect(0, 0, W, 20, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    doc.text(APP_NAME.toUpperCase(), M, 13)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text("Liste de présences", W - M, 13, { align: "right" })

    // ── Event title + meta ──────────────────────────────────────────────────
    let y = 32
    doc.setTextColor(...BLACK)
    doc.setFontSize(16)
    doc.setFont("helvetica", "bold")
    doc.text(title, M, y)
    y += 7

    doc.setFontSize(8.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...ZINC)
    const dateStr = format(new Date(ev!.date), "EEEE dd MMMM yyyy · HH'h'mm", { locale: fr })
    doc.text(dateStr, M, y)
    if (ev?.location) {
      doc.text(`· ${ev.location}`, M + doc.getTextWidth(dateStr) + 2, y)
    }
    doc.text(`Généré le ${today}`, W - M, y, { align: "right" })
    y += 10

    // ── Stats chips ─────────────────────────────────────────────────────────
    const paidCount = hasFee ? typed.filter(r => r.ticketPaidAt != null).length : 0
    const stats: { value: string; label: string }[] = [
      { value: String(presentsCount), label: presentsCount !== 1 ? "présents" : "présent" },
      ...(capacity ? [{ value: String(capacity), label: "capacité" }] : []),
      ...(hasFee    ? [{ value: String(paidCount),    label: paidCount    !== 1 ? "payés"    : "payé"    }] : []),
      ...(hasFee    ? [{ value: String(reservedCount), label: reservedCount !== 1 ? "réservés" : "réservé" }] : []),
    ]

    const chipW = 36
    const chipH = 16
    stats.forEach((s, i) => {
      const x = M + i * (chipW + 3)
      doc.setFillColor(244, 244, 245)
      doc.roundedRect(x, y, chipW, chipH, 2, 2, "F")
      doc.setTextColor(...BLACK)
      doc.setFontSize(12)
      doc.setFont("helvetica", "bold")
      doc.text(s.value, x + chipW / 2, y + 7, { align: "center" })
      doc.setFontSize(7)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...ZINC)
      doc.text(s.label, x + chipW / 2, y + 13, { align: "center" })
    })
    y += chipH + 6

    // ── Separator ───────────────────────────────────────────────────────────
    doc.setDrawColor(228, 228, 231)
    doc.line(M, y, W - M, y)
    y += 5

    // ── Table ───────────────────────────────────────────────────────────────
    const commonTableOpts = {
      margin:             { left: M, right: M },
      headStyles:         { fillColor: BLACK, textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const, fontSize: 8 },
      bodyStyles:         { fontSize: 8.5, textColor: BLACK },
      alternateRowStyles: { fillColor: [250, 250, 250] as [number, number, number] },
      styles:             { cellPadding: 3, lineColor: [228, 228, 231] as [number, number, number], lineWidth: 0.1 },
    }

    if (hasFee) {
      autoTable(doc, {
        ...commonTableOpts,
        startY:       y,
        head:         [["#", "Membre", "Présent", "Paiement"]],
        body:         typed.map((r, i) => [
          i + 1,
          `${r.lastName} ${r.firstName}`,
          r.present ? "Oui" : "",
          r.ticketPaidAt ? "Payé" : r.rsvp === "CONFIRME" ? "Réservé" : "—",
        ]),
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          2: { cellWidth: 20, halign: "center" },
          3: { cellWidth: 26 },
        },
        didParseCell: (data) => {
          if (data.section !== "body") return
          if (data.column.index === 2 && data.cell.raw === "Oui") {
            data.cell.styles.textColor = [22, 163, 74]
            data.cell.styles.fontStyle = "bold"
          }
          if (data.column.index === 3) {
            if (data.cell.raw === "Payé")    data.cell.styles.textColor = [22, 163, 74]
            if (data.cell.raw === "Réservé") data.cell.styles.textColor = [37, 99, 235]
            if (data.cell.raw === "—")       data.cell.styles.textColor = ZINC
          }
        },
      })
    } else {
      autoTable(doc, {
        ...commonTableOpts,
        startY:       y,
        head:         [["#", "Membre", "Présent", "RSVP"]],
        body:         typed.map((r, i) => [
          i + 1,
          `${r.lastName} ${r.firstName}`,
          r.present ? "Oui" : "",
          r.rsvp ? (RSVP_LABELS[r.rsvp]?.label ?? "—") : "—",
        ]),
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          2: { cellWidth: 22, halign: "center" },
        },
        didParseCell: (data) => {
          if (data.section !== "body") return
          if (data.column.index === 2 && data.cell.raw === "Oui") {
            data.cell.styles.textColor = [22, 163, 74]
            data.cell.styles.fontStyle = "bold"
          }
          if (data.column.index === 3 && data.cell.raw === "—") {
            data.cell.styles.textColor = ZINC
          }
        },
      })
    }

    // ── Per-page footer ─────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages()
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p)
      doc.setDrawColor(228, 228, 231)
      doc.line(M, 287, W - M, 287)
      doc.setFontSize(7.5)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...ZINC)
      doc.text(`Page ${p} / ${pageCount}`, M, 292)
      doc.text(`Généré par ${APP_NAME}`, W - M, 292, { align: "right" })
    }

    doc.save(`presences_${title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`)
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
  const isPast   = new Date(ev.date) < new Date()

  const now = new Date()
  const { opensAt: checkInOpensAt, closesAt: checkInClosesAt } = getCheckInWindow(ev)
  const checkInWindowState =
    now < checkInOpensAt  ? "before" :
    now > checkInClosesAt ? "after"  : "open"

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
            <DownloadSimpleIcon className="mr-1.5 size-4" />
            Exporter
            <CaretDownIcon className="ml-1 size-3" />
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

      {/* Check-in window status */}
      {checkInWindowState !== "open" && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400 text-xs px-3 py-2.5">
          <WarningCircleIcon className="size-4 shrink-0 mt-0.5" />
          <span>
            {checkInWindowState === "before" ? (
              <>
                Le check-in via QR Code n&apos;ouvrira que le{" "}
                <strong>{format(checkInOpensAt, "dd MMM · HH:mm", { locale: fr })}</strong> (3h avant le début de l&apos;événement).
              </>
            ) : (
              <>
                Le check-in via QR Code est fermé depuis le{" "}
                <strong>{format(checkInClosesAt, "dd MMM · HH:mm", { locale: fr })}</strong>{" "}
                {ev.endDate
                  ? "(6h après la fin de l'événement)."
                  : "(aucune heure de fin n'est définie pour cet événement — la fenêtre se ferme 6h après début + 24h par défaut)."}
              </>
            )}{" "}
            Vous pouvez toujours cocher les présences manuellement dans la liste ci-dessous.
          </span>
        </div>
      )}

      {/* Counter */}
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
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
            {hasFee && reservedCount > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <BookmarkSimpleIcon className="size-3.5" />
                  {reservedCount} réservé{reservedCount !== 1 ? "s" : ""}
                  {capacity && ` / ${capacity}`}
                </span>
              </>
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

      {/* Two columns: QR + ListIcon */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">

        {/* QR Panel */}
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">QR Code de check-in</h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <InfoIcon className="size-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-64">
                  Un seul QR pour tout l&apos;événement, valide 24h. Chaque participant le scanne
                  avec son téléphone, se connecte au portail si besoin, puis confirme sa venue —
                  cela marque présent son billet et ceux de ses invité·e·s nommé·e·s. Il faut avoir
                  un billet payé (événement payant) ou un RSVP confirmé (événement gratuit) pour
                  que ça marche.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

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
                          <ArrowsClockwiseIcon className="mr-1.5 size-3.5" />
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
          <div className="p-3 border-b flex items-center gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Rechercher…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {!isPast && (
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAddGuestOpen(true)}>
                <UserPlusIcon className="mr-1.5 size-3.5" />
                Ajouter un invité
              </Button>
            )}
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
                <div
                  key={rowKey(row)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 text-sm transition-colors",
                    row.present
                      ? "bg-green-50 dark:bg-green-950/30"
                      : "bg-background",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleToggle(row)}
                    disabled={pendingIds.has(rowKey(row))}
                    className="flex flex-1 items-center justify-between gap-3 text-left min-w-0"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className={cn("font-medium truncate", row.present && "text-green-700 dark:text-green-400")}>
                        {row.lastName} {row.firstName}
                      </span>
                      {row.isGuest && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                          Invité
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {!hasFee && row.rsvp && RSVP_LABELS[row.rsvp] && (
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

                  {hasFee && (
                    row.ticketPaidAt ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-400">
                          <CheckIcon className="size-3" />
                          Payé
                        </span>
                        {!row.stripeSessionId && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={<span />}>
                                <button
                                  type="button"
                                  onClick={() => handleCancelPayment(row)}
                                  disabled={cancelPayIds.has(rowKey(row))}
                                  className="flex items-center justify-center size-5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <XIcon className="size-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Annuler ce paiement en espèces</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    ) : row.rsvp === "CONFIRME" ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="flex items-center gap-1 text-[10px] font-medium text-primary shrink-0">
                          <BookmarkSimpleIcon className="size-3" />
                          Réservé
                        </span>
                        <button
                          type="button"
                          onClick={() => handleMarkPaid(row)}
                          disabled={payingIds.has(rowKey(row))}
                          className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground shrink-0 border rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                        >
                          <MoneyIcon className="size-3" />
                          Marquer payé
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleMarkPaid(row)}
                        disabled={payingIds.has(rowKey(row))}
                        className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground shrink-0 border rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                      >
                        <MoneyIcon className="size-3" />
                        Marquer payé
                      </button>
                    )
                  )}

                  {row.isGuest && !isPast && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Modifier"
                      >
                        <PencilSimpleIcon className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Retirer"
                      >
                        <TrashIcon className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add walk-in guest */}
      <Modal
        open={addGuestOpen}
        onOpenChange={setAddGuestOpen}
        title="Ajouter un invité"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddGuestOpen(false)}>Annuler</Button>
            <Button
              loading={addGuest.isPending}
              disabled={!guestFirstName.trim() || !guestLastName.trim()}
              onClick={handleAddGuest}
            >
              <UserPlusIcon className="mr-1.5 size-4" />
              Ajouter et marquer présent
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Prénom</label>
            <input
              type="text"
              value={guestFirstName}
              onChange={e => setGuestFirstName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Nom</label>
            <input
              type="text"
              value={guestLastName}
              onChange={e => setGuestLastName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Email <span className="text-muted-foreground font-normal">(optionnel)</span>
            </label>
            <input
              type="email"
              value={guestEmail}
              onChange={e => setGuestEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </Modal>

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

      {/* Edit guest */}
      <Modal
        open={!!editTarget}
        onOpenChange={o => { if (!o) setEditTarget(null) }}
        title="Modifier l'invité·e"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Annuler</Button>
            <Button
              loading={editGuest.isPending}
              disabled={!editFirstName.trim() || !editLastName.trim()}
              onClick={handleEditGuest}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Prénom</label>
            <input
              type="text"
              value={editFirstName}
              onChange={e => setEditFirstName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Nom</label>
            <input
              type="text"
              value={editLastName}
              onChange={e => setEditLastName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Email <span className="text-muted-foreground font-normal">(optionnel)</span>
            </label>
            <input
              type="email"
              value={editEmail}
              onChange={e => setEditEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </Modal>

      {/* Remove guest */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null) }}
        title={`Retirer ${deleteTarget?.firstName} ${deleteTarget?.lastName} ?`}
        description={
          deleteTarget?.present
            ? "Cette personne est déjà marquée présente — retirer sa fiche effacera aussi cette présence."
            : "Cette personne sera retirée de la liste de présences de cet événement."
        }
        confirmLabel="Retirer"
        loading={deleteGuest.isPending}
        onConfirm={handleDeleteGuest}
      />
    </div>
  )
}
