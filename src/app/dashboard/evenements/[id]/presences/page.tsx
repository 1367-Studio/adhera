"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getPusherClient } from "@/lib/pusher-client"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { QRCodeSVG } from "qrcode.react"
import { MoneyIcon, BookmarkSimpleIcon, CheckIcon, CaretDownIcon, DownloadSimpleIcon, GiftIcon, InfoIcon, PaperPlaneRightIcon, PencilSimpleIcon, QrCodeIcon, ArrowsClockwiseIcon, MagnifyingGlassIcon, ScanIcon, TrashIcon, UserPlusIcon, UsersIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
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
import { BASE_PATH } from "@/lib/env"
import { Modal } from "@/components/ui/modal"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { SelectField } from "@/components/ui/select-field"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { cn } from "@/lib/utils"
import { loadLogoForPdf } from "@/lib/pdf/branded-header-client"

type PresenceRow = {
  membreId:        string | null
  firstName:       string
  lastName:        string
  email:           string | null
  phone:           string | null
  address:         string | null
  answers:         Record<string, string> | null
  participationId: string | null
  present:         boolean
  rsvp:            string | null
  ticketPaidAt:    string | null
  amount:          string | null
  stripeSessionId: string | null
  ticketTypeLabel: string | null
  isGuest:         boolean
}

function rowRef(row: PresenceRow): RowRef {
  return row.participationId ? { participationId: row.participationId } : { membreId: row.membreId! }
}

function rowKey(row: PresenceRow): string {
  return row.participationId ?? row.membreId!
}

function hasExtraInfo(row: PresenceRow): boolean {
  return !!(row.email || row.phone || row.address || (row.answers && Object.keys(row.answers).length > 0))
}

type CustomField = { id: string; type: "TEXT" | "NUMBER"; label: string; required: boolean }

type EvenementTicketType = { id: string; label: string; price: string }

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
  customFields: CustomField[]
  ticketTypes:  EvenementTicketType[]
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

type Translator = ReturnType<typeof useTranslations>

function getRsvpConfig(t: Translator): Record<string, { label: string; classes: string }> {
  return {
    CONFIRME: { label: t("evenements.presences.rsvp.confirme"), classes: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    PROVAVEL: { label: t("evenements.presences.rsvp.provavel"), classes: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
    INCERTO:  { label: t("evenements.presences.rsvp.incerto"),  classes: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
    ABSENT:   { label: t("evenements.presences.rsvp.absent"),   classes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  }
}

export default function PresencesPage() {
  const t       = useTranslations()
  const { id }  = useParams<{ id: string }>()
  const qc      = useQueryClient()
  const user    = useCurrentUser()
  const RSVP_LABELS = getRsvpConfig(t)
  // Mirrors FREE_MANAGERS server-side (src/app/api/evenements/[id]/participations/
  // route.ts) — hiding the action for roles that would just get a 403 back.
  const canMarkFree = user.role === "ADMIN" || user.role === "PRESIDENT"

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
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null)
  const [memberQuery, setMemberQuery] = useState("")
  const [debouncedMemberQuery, setDebouncedMemberQuery] = useState("")
  const [guestFirstName, setGuestFirstName] = useState("")
  const [guestLastName,  setGuestLastName]  = useState("")
  const [guestEmail,     setGuestEmail]     = useState("")
  const [editTarget, setEditTarget]     = useState<PresenceRow | null>(null)
  const [editFirstName, setEditFirstName] = useState("")
  const [editLastName,  setEditLastName]  = useState("")
  const [editEmail,     setEditEmail]     = useState("")
  const [deleteTarget, setDeleteTarget] = useState<PresenceRow | null>(null)
  const [infoTarget, setInfoTarget]     = useState<PresenceRow | null>(null)
  const [sendingTickets, setSendingTickets] = useState(false)
  const [tierPickerTarget, setTierPickerTarget] = useState<PresenceRow | null>(null)
  const [selectedTierId,   setSelectedTierId]   = useState("")

  const { data: evenement, isLoading: loadingEvent } = useEvenement(id)
  const ev = evenement as Evenement | undefined

  // Logo pour le PDF de présences (handleExportPdf) — même règle Pro-only que
  // les devis/factures, voir canUseCustomBranding() dans src/lib/plan-limits.ts.
  const { data: assoc } = useQuery<{
    name: string
    plan: "ESSENTIAL" | "PRO"
    customBrandingEnabled: boolean | null
    logoUrl: string | null
  }>({
    queryKey: ["association"],
    queryFn:  () => fetch("/api/association").then(r => r.json()),
  })

  // Fetched only while the "Ajouter un membre" modal is open — this is the pool the
  // check-in list used to show unconditionally for every event (see the API route's own
  // comment); it's now opt-in, one member at a time, to stop every event page from
  // looking like the whole membership roster is "in" it. Searched server-side (debounced)
  // rather than fetched once and filtered client-side — a client-side cap would silently
  // hide members past it, defeating the point on exactly the large (e.g. AssoConnect-
  // imported) rosters that motivated this change in the first place.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMemberQuery(memberQuery), 250)
    return () => clearTimeout(timer)
  }, [memberQuery])

  const memberQueryReady = debouncedMemberQuery.trim().length >= 2
  const { data: activeMembres = [], isLoading: loadingActiveMembres } = useQuery<{ id: string; firstName: string; lastName: string }[]>({
    queryKey: ["membres-active-for-event", debouncedMemberQuery],
    queryFn:  () => fetch(`/api/membres?status=ACTIF&search=${encodeURIComponent(debouncedMemberQuery.trim())}`).then(r => r.json()),
    enabled:  addMemberOpen && memberQueryReady,
  })

  // Merge local state with server state (local takes precedence after mutations)
  const activeToken     = qrToken     ?? ev?.qrToken     ?? null
  const activeExpiresAt = qrExpiresAt ?? ev?.qrExpiresAt ?? null
  const activeExpired   = activeExpiresAt ? new Date(activeExpiresAt) < new Date() : false
  const activeQrValid   = !!(activeToken && !activeExpired)
  const checkInUrl      = activeToken && user.associationSlug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${BASE_PATH}/check-in/${user.associationSlug}/${activeToken}`
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
  const linkedMembreIds = useMemo(() => new Set(typed.filter(r => r.membreId).map(r => r.membreId!)), [typed])
  const memberCandidates = useMemo(
    () => activeMembres.filter(m => !linkedMembreIds.has(m.id)),
    [activeMembres, linkedMembreIds],
  )
  const hasFee         = !!ev?.ticketTypes.length || (!!ev?.price && Number(ev.price) > 0)
  const hasMultipleTicketTypes = (ev?.ticketTypes.length ?? 0) > 1
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

  function submitMarkPaid(row: PresenceRow, ticketTypeId?: string) {
    const key = rowKey(row)
    if (payingIds.has(key)) return
    setPayingIds(prev => new Set(prev).add(key))
    markPaid.mutate({ ...rowRef(row), ticketTypeId }, {
      onSuccess: () => {
        toast.success(t("evenements.presences.toasts.markedPaid", { name: `${row.firstName} ${row.lastName}` }))
        setTierPickerTarget(null)
      },
      onError:   (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
      onSettled: () => setPayingIds(prev => { const s = new Set(prev); s.delete(key); return s }),
    })
  }

  // Admin-only exemption (VIP, staff, speaker…) — distinct from a €0 tarif on the event
  // itself, which would be publicly selectable by anyone registering. No tier picker: it
  // applies to this one row regardless of how many tarifs the event has.
  function submitMarkFree(row: PresenceRow) {
    const key = rowKey(row)
    if (payingIds.has(key)) return
    setPayingIds(prev => new Set(prev).add(key))
    markPaid.mutate({ ...rowRef(row), free: true }, {
      onSuccess: () => toast.success(t("evenements.presences.toasts.markedFree", { name: `${row.firstName} ${row.lastName}` })),
      onError:   (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
      onSettled: () => setPayingIds(prev => { const s = new Set(prev); s.delete(key); return s }),
    })
  }

  // A registration that never picked a tier (typically a walk-in added at the door) is
  // ambiguous once the event has more than one — ask instead of silently charging the
  // cheapest one. Anyone who already has a tier, or an event with at most one, pays in
  // a single click as before.
  function handleMarkPaid(row: PresenceRow) {
    if (hasMultipleTicketTypes && !row.ticketTypeLabel) {
      setSelectedTierId("")
      setTierPickerTarget(row)
      return
    }
    submitMarkPaid(row)
  }

  function handleCancelPayment(row: PresenceRow) {
    const key = rowKey(row)
    if (cancelPayIds.has(key)) return
    setCancelPayIds(prev => new Set(prev).add(key))
    cancelPaid.mutate(rowRef(row), {
      onSuccess: () => toast.success(t("evenements.presences.toasts.paymentCancelled", { name: `${row.firstName} ${row.lastName}` })),
      onError:   (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
      onSettled: () => setCancelPayIds(prev => { const s = new Set(prev); s.delete(key); return s }),
    })
  }

  async function handleAddGuest() {
    if (!guestFirstName.trim() || !guestLastName.trim()) return
    try {
      await addGuest.mutateAsync({ firstName: guestFirstName.trim(), lastName: guestLastName.trim(), email: guestEmail.trim() || undefined })
      toast.success(t("evenements.presences.toasts.guestAdded", { name: `${guestFirstName} ${guestLastName}` }))
      setAddGuestOpen(false)
      setGuestFirstName(""); setGuestLastName(""); setGuestEmail("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  // Reuses the same mutation as toggling presence on a row — POST lazily creates the
  // Participation for this member. present stays false on purpose, same as adding a
  // guest: cmdk selects an item on Enter as well as click, so auto-marking present here
  // would let a stray Enter while typing a search silently check someone in who never
  // showed up. Adding them to the list is enough; presence is still one click away.
  async function handleAddMember(m: { id: string; firstName: string; lastName: string }) {
    if (addingMemberId) return
    setAddingMemberId(m.id)
    try {
      await toggle.mutateAsync({ membreId: m.id, present: false })
      toast.success(t("evenements.presences.toasts.memberAdded", { name: `${m.firstName} ${m.lastName}` }))
      setAddMemberOpen(false)
      setMemberQuery("")
      setDebouncedMemberQuery("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    } finally {
      setAddingMemberId(null)
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
      toast.success(t("evenements.presences.toasts.guestUpdated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDeleteGuest() {
    if (!deleteTarget) return
    try {
      await deleteGuest.mutateAsync(deleteTarget.participationId!)
      toast.success(t("evenements.presences.toasts.guestRemoved", { name: `${deleteTarget.firstName} ${deleteTarget.lastName}` }))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
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
      toast.error(t("evenements.presences.toasts.updateError"))
    } finally {
      setPendingIds(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  async function handleGenerateQr() {
    try {
      const result = await generateQr.mutateAsync()
      setQrToken(result.qrToken)
      setQrExpiresAt(result.qrExpiresAt)
      toast.success(t("evenements.presences.toasts.qrGenerated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  // Backfills + emails entry QR codes for attendees registered before the ticket-QR
  // feature (their confirmation email carried none) — see /api/evenements/[id]/send-tickets.
  async function handleSendMissingQr() {
    setSendingTickets(true)
    try {
      const res  = await fetch(`/api/evenements/${id}/send-tickets`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? t("evenements.scanner.resendError"))
        return
      }
      if (data.sent === 0 && data.failed === 0) {
        toast.info(t("evenements.scanner.resendNone"))
      } else {
        if (data.sent > 0) toast.success(t("evenements.scanner.resendDone", { count: data.sent }))
        if (data.failed > 0) toast.error(t("evenements.scanner.resendFailed", { count: data.failed }))
      }
    } catch {
      toast.error(t("evenements.scanner.resendError"))
    } finally {
      setSendingTickets(false)
    }
  }

  async function handleRevokeQr() {
    try {
      await revokeQr.mutateAsync()
      setQrToken(null)
      setQrExpiresAt(null)
      toast.success(t("evenements.presences.toasts.qrRevoked"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleExportPdf() {
    if (typed.length === 0) {
      toast.error(t("evenements.presences.toasts.noMembersToExport"))
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

    // Branding gated the same way as devis/facture PDFs — Pro by default, see
    // canUseCustomBranding() in src/lib/plan-limits.ts.
    const canBrand = assoc ? (assoc.customBrandingEnabled ?? assoc.plan === "PRO") : false
    const headerRgb: [number, number, number] = [0, 0, 0]
    const logo = canBrand && assoc?.logoUrl ? await loadLogoForPdf("/api/association/branding/logo") : null

    // ── Header bar ─────────────────────────────────────────────────────────
    const headerH = 30
    doc.setFillColor(...headerRgb)
    doc.rect(0, 0, W, headerH, "F")
    doc.setTextColor(255, 255, 255)

    // Measured before switching fonts for the name — "Liste de présences" is drawn at
    // normal/9, and reserving its width up front keeps a long association name from
    // running into it on the same line.
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    const rightLabelW = doc.getTextWidth("Liste de présences")

    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    if (logo) {
      const logoH = 20
      const logoW = logo.width * (logoH / logo.height)
      doc.addImage(logo.dataUrl, logo.format, M, (headerH - logoH) / 2, logoW, logoH)
    } else {
      const availW = (W - M) - M - rightLabelW - 6
      const fullName = (canBrand ? assoc!.name : APP_NAME).toUpperCase()
      let name = fullName
      while (name.length > 1 && doc.getTextWidth(`${name}…`) > availW) name = name.slice(0, -1)
      doc.text(name.length < fullName.length ? `${name}…` : name, M, headerH / 2 + 3)
    }
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text("Liste de présences", W - M, headerH / 2 + 3, { align: "right" })

    // ── Event title + meta ──────────────────────────────────────────────────
    let y = headerH + 12
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
    // "Payé" here means real money changed hands — a "Marquer gratuit" exemption or a
    // genuine €0 tarif both set ticketPaidAt but must never inflate this count (see the
    // matching fix in export/route.ts's Paiement column).
    const paidCount = hasFee ? typed.filter(r => r.ticketPaidAt != null && Number(r.amount ?? 0) > 0).length : 0
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
    // Compact "Infos" column — only added when at least one row actually has phone/
    // address/custom-field data, so an ordinary members-only event's PDF isn't padded
    // with an empty column no one asked for.
    const showInfoCol = typed.some(hasExtraInfo)
    const contactLine = (r: PresenceRow) => {
      const parts: string[] = []
      if (r.email) parts.push(r.email)
      if (r.phone) parts.push(r.phone)
      if (r.address) parts.push(r.address)
      for (const f of ev?.customFields ?? []) {
        const v = r.answers?.[f.id]
        if (v) parts.push(`${f.label}: ${v}`)
      }
      return parts.join(" · ")
    }

    const commonTableOpts = {
      margin:             { left: M, right: M },
      headStyles:         { fillColor: headerRgb, textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const, fontSize: 8 },
      bodyStyles:         { fontSize: 8.5, textColor: BLACK },
      alternateRowStyles: { fillColor: [250, 250, 250] as [number, number, number] },
      styles:             { cellPadding: 3, lineColor: [228, 228, 231] as [number, number, number], lineWidth: 0.1 },
    }

    if (hasFee) {
      autoTable(doc, {
        ...commonTableOpts,
        startY:       y,
        head:         [["#", "Membre", "Présent", "Paiement", ...(showInfoCol ? ["Infos"] : [])]],
        body:         typed.map((r, i) => [
          i + 1,
          `${r.lastName} ${r.firstName}`,
          r.present ? "Oui" : "",
          r.ticketPaidAt ? (Number(r.amount ?? 0) === 0 ? "Gratuit" : "Payé") : r.rsvp === "CONFIRME" ? "Réservé" : "—",
          ...(showInfoCol ? [contactLine(r)] : []),
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
            if (data.cell.raw === "Gratuit" || data.cell.raw === "—") data.cell.styles.textColor = ZINC
          }
        },
      })
    } else {
      autoTable(doc, {
        ...commonTableOpts,
        startY:       y,
        head:         [["#", "Membre", "Présent", "RSVP", ...(showInfoCol ? ["Infos"] : [])]],
        body:         typed.map((r, i) => [
          i + 1,
          `${r.lastName} ${r.firstName}`,
          r.present ? "Oui" : "",
          r.rsvp ? (RSVP_LABELS[r.rsvp]?.label ?? "—") : "—",
          ...(showInfoCol ? [contactLine(r)] : []),
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
    return <DetailLoadingSkeleton />
  }

  if (!ev) {
    return (
      <DetailNotFound
        message={t("evenements.presences.notFound.message")}
        backHref="/dashboard/evenements"
        backLabel={t("evenements.presences.notFound.backLabel")}
      />
    )
  }

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
        <BackLink href="/dashboard/evenements">{t("evenements.view.title")}</BackLink>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
            <DownloadSimpleIcon className="mr-1.5 size-4" />
            {t("evenements.presences.export.button")}
            <CaretDownIcon className="ml-1 size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => window.location.href = `${BASE_PATH}/api/evenements/${id}/export?format=csv`}>
              {t("evenements.presences.export.csv")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.location.href = `${BASE_PATH}/api/evenements/${id}/export?format=xlsx`}>
              {t("evenements.presences.export.excel")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportPdf}>
              {t("evenements.presences.export.pdf")}
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
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400 text-xs px-3 py-2.5">
          <WarningCircleIcon className="size-4 shrink-0 mt-0.5" />
          <span>
            {checkInWindowState === "before" ? (
              <>
                {t("evenements.presences.checkInWindow.beforePrefix")}{" "}
                <strong>{format(checkInOpensAt, "dd MMM · HH:mm", { locale: fr })}</strong> {t("evenements.presences.checkInWindow.beforeSuffix")}
              </>
            ) : (
              <>
                {t("evenements.presences.checkInWindow.afterPrefix")}{" "}
                <strong>{format(checkInClosesAt, "dd MMM · HH:mm", { locale: fr })}</strong>{" "}
                {ev.endDate
                  ? t("evenements.presences.checkInWindow.afterSuffixWithEnd")
                  : t("evenements.presences.checkInWindow.afterSuffixNoEnd")}
              </>
            )}{" "}
            {t("evenements.presences.checkInWindow.manualHint")}
          </span>
        </div>
      )}

      {/* Counter */}
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <UsersIcon className="size-4 text-muted-foreground" />
            <span className="text-2xl font-bold">{presentsCount}</span>
            {capacity && (
              <span className="text-lg text-muted-foreground">/ {capacity}</span>
            )}
            <span className="text-sm text-muted-foreground">
              {t("evenements.presences.counter.presentWord", { count: presentsCount })}
            </span>
            {isFull && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {t("evenements.presences.counter.full")}
              </span>
            )}
            {hasFee && reservedCount > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <BookmarkSimpleIcon className="size-3.5" />
                  {t("evenements.view.reservedCount", { count: reservedCount })}
                  {capacity && ` / ${capacity}`}
                </span>
              </>
            )}
          </div>
          {activeQrValid && (
            <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <span className="size-2 rounded-full bg-green-500 animate-pulse" />
              {t("evenements.presences.counter.liveCheckIn")}
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
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">{t("evenements.presences.qr.heading")}</h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <InfoIcon className="size-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-64">
                  {t("evenements.presences.qr.infoTooltip")}
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
                {t("evenements.presences.qr.expiresOn", { date: format(new Date(activeExpiresAt!), "dd MMM · HH:mm", { locale: fr }) })}
              </p>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => { navigator.clipboard.writeText(checkInUrl); toast.success(t("evenements.presences.toasts.linkCopied")) }}
                >
                  {t("evenements.presences.qr.copyLink")}
                </Button>
                <div className="flex gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger render={<span className="flex-1" />}>
                        <Button variant="outline" size="sm" className="w-full" onClick={() => setRegenerateConfirmOpen(true)} loading={generateQr.isPending}>
                          <ArrowsClockwiseIcon className="mr-1.5 size-3.5" />
                          {t("evenements.presences.qr.regenerate")}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("evenements.presences.qr.regenerateTooltip")}</TooltipContent>
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
                      <TooltipContent>{t("evenements.presences.qr.revokeTooltip")}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center space-y-3 py-4">
              <QrCodeIcon className="size-12 mx-auto text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                {activeToken && activeExpired ? t("evenements.presences.qr.expired") : t("evenements.presences.qr.none")}
              </p>
              <Button onClick={handleGenerateQr} loading={generateQr.isPending} className="w-full">
                <QrCodeIcon className="mr-1.5 size-4" />
                {t("evenements.presences.qr.generate")}
              </Button>
            </div>
          )}

          <div className="border-t pt-3 space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              nativeButton={false}
              render={<Link href={`/dashboard/evenements/${id}/presences/scan`} />}
            >
              <ScanIcon className="mr-1.5 size-3.5" />
              {t("evenements.scanner.openButton")}
            </Button>
            {ev && getCheckInWindow(ev).closesAt > new Date() && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={handleSendMissingQr}
                loading={sendingTickets}
              >
                <PaperPlaneRightIcon className="mr-1.5 size-3.5" />
                {t("evenements.scanner.resendButton")}
              </Button>
            )}
          </div>
        </div>

        {/* Member list */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-3 border-b flex items-center gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder={t("evenements.presences.list.searchPlaceholder")}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {!isPast && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span />}>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAddMemberOpen(true)}>
                      <UserPlusIcon className="mr-1.5 size-3.5" />
                      {t("evenements.presences.list.addMember")}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-56">{t("evenements.presences.list.addMemberTooltip")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<span />}>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAddGuestOpen(true)}>
                      <UserPlusIcon className="mr-1.5 size-3.5" />
                      {t("evenements.presences.list.addGuest")}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-56">{t("evenements.presences.list.addGuestTooltip")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
              {search ? t("evenements.presences.list.noResults") : t("evenements.presences.list.noParticipants")}
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
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                          {t("evenements.presences.list.guestBadge")}
                        </span>
                      )}
                      {hasMultipleTicketTypes && row.ticketTypeLabel && (
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                          · {row.ticketTypeLabel}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {!hasFee && row.rsvp && RSVP_LABELS[row.rsvp] && (
                        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full hidden sm:inline", RSVP_LABELS[row.rsvp].classes)}>
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
                        <span className={cn(
                          "flex items-center gap-1 text-xs font-medium",
                          row.amount != null && Number(row.amount) === 0
                            ? "text-muted-foreground"
                            : "text-green-600 dark:text-green-400",
                        )}>
                          {row.amount != null && Number(row.amount) === 0
                            ? <GiftIcon className="size-3" />
                            : <CheckIcon className="size-3" />}
                          {row.amount != null && Number(row.amount) === 0
                            ? t("evenements.presences.list.freeBadge")
                            : t("evenements.presences.list.paidBadge")}
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
                              <TooltipContent>{t("evenements.presences.list.cancelPaymentTooltip")}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    ) : row.rsvp === "CONFIRME" ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="flex items-center gap-1 text-xs font-medium text-primary shrink-0">
                          <BookmarkSimpleIcon className="size-3" />
                          {t("evenements.presences.list.reservedBadge")}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleMarkPaid(row)}
                          disabled={payingIds.has(rowKey(row))}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground shrink-0 border rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                        >
                          <MoneyIcon className="size-3" />
                          {t("evenements.presences.list.markPaid")}
                        </button>
                        {canMarkFree && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={<span />}>
                                <button
                                  type="button"
                                  onClick={() => submitMarkFree(row)}
                                  disabled={payingIds.has(rowKey(row))}
                                  className="flex items-center justify-center size-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                  <GiftIcon className="size-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{t("evenements.presences.list.markFreeTooltip")}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMarkPaid(row)}
                          disabled={payingIds.has(rowKey(row))}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground shrink-0 border rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                        >
                          <MoneyIcon className="size-3" />
                          {t("evenements.presences.list.markPaid")}
                        </button>
                        {canMarkFree && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={<span />}>
                                <button
                                  type="button"
                                  onClick={() => submitMarkFree(row)}
                                  disabled={payingIds.has(rowKey(row))}
                                  className="flex items-center justify-center size-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                  <GiftIcon className="size-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{t("evenements.presences.list.markFreeTooltip")}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    )
                  )}

                  {hasExtraInfo(row) && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={<span />}>
                          <button
                            type="button"
                            onClick={() => setInfoTarget(row)}
                            className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                          >
                            <InfoIcon className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t("evenements.presences.list.infoTooltip")}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {row.isGuest && !isPast && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title={t("evenements.presences.list.editTitle")}
                      >
                        <PencilSimpleIcon className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title={t("evenements.presences.list.removeTitle")}
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
        title={t("evenements.presences.addGuestModal.title")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddGuestOpen(false)}>{t("common.cancel")}</Button>
            <Button
              loading={addGuest.isPending}
              disabled={!guestFirstName.trim() || !guestLastName.trim()}
              onClick={handleAddGuest}
            >
              <UserPlusIcon className="mr-1.5 size-4" />
              {t("evenements.presences.addGuestModal.submit")}
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t("membres.form.fields.firstName")}</label>
            <input
              type="text"
              value={guestFirstName}
              onChange={e => setGuestFirstName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t("membres.form.fields.lastName")}</label>
            <input
              type="text"
              value={guestLastName}
              onChange={e => setGuestLastName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              {t("membres.form.fields.email")} <span className="text-muted-foreground font-normal">{t("evenements.presences.addGuestModal.optional")}</span>
            </label>
            <input
              type="email"
              value={guestEmail}
              onChange={e => setGuestEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">{t("evenements.presences.addGuestModal.emailHint")}</p>
          </div>
        </div>
      </Modal>

      {/* Find and add an existing member, without listing every active member on the
          page by default (see the participations API's own comment). Presence itself
          isn't set here — see handleAddMember. */}
      <Modal
        open={addMemberOpen}
        onOpenChange={(open) => {
          setAddMemberOpen(open)
          if (!open) { setMemberQuery(""); setDebouncedMemberQuery("") }
        }}
        title={t("evenements.presences.addMemberModal.title")}
        size="sm"
      >
        {/* shouldFilter=false: the association's active members are searched server-side
            (see the query above), not filtered client-side against a locally fetched
            list — cmdk's own fuzzy filter would otherwise re-narrow (and could hide)
            results it never fetched in the first place. */}
        <Command className="rounded-lg! border" shouldFilter={false}>
          <CommandInput
            value={memberQuery}
            onValueChange={setMemberQuery}
            placeholder={t("evenements.presences.addMemberModal.searchPlaceholder")}
          />
          <CommandList>
            {!memberQueryReady ? (
              <CommandEmpty>{t("evenements.presences.addMemberModal.typeToSearch")}</CommandEmpty>
            ) : loadingActiveMembres ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-8 rounded-md bg-muted animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {activeMembres.length > 0 && memberCandidates.length === 0
                    ? t("evenements.presences.addMemberModal.allAdded")
                    : t("evenements.presences.addMemberModal.noResults")}
                </CommandEmpty>
                {memberCandidates.map(m => (
                  <CommandItem
                    key={m.id}
                    value={`${m.lastName} ${m.firstName}`}
                    disabled={addingMemberId === m.id}
                    onSelect={() => handleAddMember(m)}
                  >
                    {m.lastName} {m.firstName}
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </Modal>

      {/* Which tier to charge, when marking paid a registration that never picked one */}
      <Modal
        open={!!tierPickerTarget}
        onOpenChange={(open) => !open && setTierPickerTarget(null)}
        title={t("evenements.presences.tierPickerModal.title")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setTierPickerTarget(null)}>{t("common.cancel")}</Button>
            <Button
              loading={tierPickerTarget ? payingIds.has(rowKey(tierPickerTarget)) : false}
              disabled={!selectedTierId}
              onClick={() => tierPickerTarget && submitMarkPaid(tierPickerTarget, selectedTierId)}
            >
              <MoneyIcon className="mr-1.5 size-4" />
              {t("evenements.presences.tierPickerModal.confirm")}
            </Button>
          </>
        }
      >
        <div className="py-2">
          <SelectField
            label={t("evenements.presences.tierPickerModal.selectLabel")}
            value={selectedTierId}
            onValueChange={setSelectedTierId}
            options={(ev?.ticketTypes ?? []).map(tt => ({
              value: tt.id,
              label: `${tt.label} — ${Number(tt.price).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`,
            }))}
          />
        </div>
      </Modal>

      {/* Registration details (phone/address/custom field answers) */}
      <Modal
        open={!!infoTarget}
        onOpenChange={(open) => !open && setInfoTarget(null)}
        title={infoTarget ? `${infoTarget.lastName} ${infoTarget.firstName}` : ""}
        size="sm"
      >
        {infoTarget && (
          <div className="space-y-3 py-2 text-sm">
            {infoTarget.email && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("evenements.presences.list.infoEmail")}</p>
                <p>{infoTarget.email}</p>
              </div>
            )}
            {infoTarget.phone && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("evenements.presences.list.infoPhone")}</p>
                <p>{infoTarget.phone}</p>
              </div>
            )}
            {infoTarget.address && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("evenements.presences.list.infoAddress")}</p>
                <p>{infoTarget.address}</p>
              </div>
            )}
            {ev.customFields.filter(f => infoTarget.answers?.[f.id]).map(f => (
              <div key={f.id}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{f.label}</p>
                <p>{infoTarget.answers![f.id]}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Revoke confirmation */}
      <ConfirmDialog
        open={revokeConfirmOpen}
        onOpenChange={setRevokeConfirmOpen}
        title={t("evenements.presences.revokeConfirm.title")}
        description={t("evenements.presences.revokeConfirm.description")}
        confirmLabel={t("evenements.presences.revokeConfirm.confirmLabel")}
        loading={revokeQr.isPending}
        onConfirm={() => { setRevokeConfirmOpen(false); handleRevokeQr() }}
      />

      {/* Regenerate confirmation */}
      <ConfirmDialog
        open={regenerateConfirmOpen}
        onOpenChange={setRegenerateConfirmOpen}
        title={t("evenements.presences.regenerateConfirm.title")}
        description={t("evenements.presences.regenerateConfirm.description")}
        confirmLabel={t("evenements.presences.qr.regenerate")}
        loading={generateQr.isPending}
        onConfirm={() => { setRegenerateConfirmOpen(false); handleGenerateQr() }}
      />

      {/* Edit guest */}
      <Modal
        open={!!editTarget}
        onOpenChange={o => { if (!o) setEditTarget(null) }}
        title={t("evenements.presences.editGuestModal.title")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{t("common.cancel")}</Button>
            <Button
              loading={editGuest.isPending}
              disabled={!editFirstName.trim() || !editLastName.trim()}
              onClick={handleEditGuest}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t("membres.form.fields.firstName")}</label>
            <input
              type="text"
              value={editFirstName}
              onChange={e => setEditFirstName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t("membres.form.fields.lastName")}</label>
            <input
              type="text"
              value={editLastName}
              onChange={e => setEditLastName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              {t("membres.form.fields.email")} <span className="text-muted-foreground font-normal">{t("evenements.presences.addGuestModal.optional")}</span>
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
        title={t("evenements.presences.deleteGuestConfirm.title", { name: `${deleteTarget?.firstName} ${deleteTarget?.lastName}` })}
        description={
          deleteTarget?.present
            ? t("evenements.presences.deleteGuestConfirm.descriptionPresent")
            : t("evenements.presences.deleteGuestConfirm.descriptionAbsent")
        }
        confirmLabel={t("evenements.presences.deleteGuestConfirm.confirmLabel")}
        loading={deleteGuest.isPending}
        onConfirm={handleDeleteGuest}
      />
    </div>
  )
}
