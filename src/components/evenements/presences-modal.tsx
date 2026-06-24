"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { QRCodeSVG } from "qrcode.react"
import { CheckIcon, ChevronDownIcon, DownloadIcon, QrCodeIcon, RefreshCwIcon, UsersIcon, XIcon } from "lucide-react"
import { useParticipations, useTogglePresence, useGenerateQr, useRevokeQr } from "@/hooks/use-evenements"
import { useCurrentUser } from "@/lib/user-context"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type RsvpStatus = "CONFIRME" | "PROVAVEL" | "INCERTO" | "ABSENT"

type PresenceRow = {
  membreId:        string
  firstName:       string
  lastName:        string
  participationId: string | null
  present:         boolean
  rsvp:            RsvpStatus | null
}

const RSVP_LABELS: Record<RsvpStatus, { label: string; classes: string }> = {
  CONFIRME: { label: "J'y serai !",    classes: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  PROVAVEL: { label: "Si possible",    classes: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  INCERTO:  { label: "Peut-être",      classes: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  ABSENT:   { label: "Je ne viens pas",classes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
}

interface PresencesModalProps {
  evenementId:    string
  evenementTitle: string
  qrToken:        string | null
  qrExpiresAt:    string | null
  open:           boolean
  onOpenChange:   (open: boolean) => void
}

export function PresencesModal({ evenementId, evenementTitle, qrToken: initialQrToken, qrExpiresAt: initialQrExpiresAt, open, onOpenChange }: PresencesModalProps) {
  const user        = useCurrentUser()
  const { data: rows = [], isLoading } = useParticipations(evenementId)
  const toggle      = useTogglePresence(evenementId)
  const generateQr  = useGenerateQr(evenementId)
  const revokeQr    = useRevokeQr(evenementId)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [qrOpen, setQrOpen]         = useState(false)
  const [qrToken, setQrToken]       = useState<string | null>(initialQrToken)
  const [qrExpiresAt, setQrExpiresAt] = useState<string | null>(initialQrExpiresAt)

  const typed        = rows as PresenceRow[]
  const presentsCount = typed.filter(r => r.present).length
  const rsvpCounts   = {
    CONFIRME: typed.filter(r => r.rsvp === "CONFIRME").length,
    PROVAVEL: typed.filter(r => r.rsvp === "PROVAVEL").length,
    INCERTO:  typed.filter(r => r.rsvp === "INCERTO").length,
    ABSENT:   typed.filter(r => r.rsvp === "ABSENT").length,
  }
  const totalRsvp = rsvpCounts.CONFIRME + rsvpCounts.PROVAVEL + rsvpCounts.INCERTO + rsvpCounts.ABSENT

  const qrExpired  = qrExpiresAt ? new Date(qrExpiresAt) < new Date() : false
  const qrValid    = qrToken && !qrExpired
  const checkInUrl = qrToken && user.associationSlug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/check-in/${user.associationSlug}/${qrToken}`
    : ""

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
      setQrOpen(true)
      toast.success("QR Code généré")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleExportPdf() {
    const { default: jsPDF }   = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")

    const doc  = new jsPDF()
    const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })

    doc.setFontSize(14)
    doc.text(`Présences — ${evenementTitle}`, 14, 18)
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(dateStr, 14, 25)
    doc.setTextColor(0)

    const rows = typed.map((r, i) => [
      i + 1,
      `${r.lastName} ${r.firstName}`,
      r.present ? "✓" : "",
      r.rsvp ? RSVP_LABELS[r.rsvp].label : "",
    ])

    autoTable(doc, {
      startY:      30,
      head:        [["#", "Membre", "Présent", "RSVP"]],
      body:        rows,
      headStyles:  { fillColor: [30, 30, 30] },
      columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 22, halign: "center" } },
      styles:      { fontSize: 9 },
    })

    doc.save(`presences_${evenementTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`)
  }

  async function handleRevokeQr() {
    try {
      await revokeQr.mutateAsync()
      setQrToken(null)
      setQrExpiresAt(null)
      toast.success("QR Code révoqué")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title={`Présences — ${evenementTitle}`} size="lg">
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-lg border bg-muted/20 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UsersIcon className="size-4" />
                <span>
                  {presentsCount} présent{presentsCount !== 1 ? "s" : ""} sur {typed.length} membre{typed.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" />}>
                    <DownloadIcon className="mr-1 size-3.5" />
                    Exporter
                    <ChevronDownIcon className="ml-1 size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => window.location.href = `/api/evenements/${evenementId}/export?format=csv`}>
                      CSV (.csv)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => window.location.href = `/api/evenements/${evenementId}/export?format=xlsx`}>
                      Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportPdf}>
                      PDF (.pdf)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => setQrOpen(true)}>
                  <QrCodeIcon className="mr-1 size-3.5" />
                  QR Code
                </Button>
              </div>
            </div>
            {totalRsvp > 0 && (
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {rsvpCounts.CONFIRME > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-green-500" />{rsvpCounts.CONFIRME} confirmé{rsvpCounts.CONFIRME > 1 ? "s" : ""}</span>}
                {rsvpCounts.PROVAVEL > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-yellow-400" />{rsvpCounts.PROVAVEL} si possible</span>}
                {rsvpCounts.INCERTO  > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-orange-400" />{rsvpCounts.INCERTO} peut-être</span>}
                {rsvpCounts.ABSENT   > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500" />{rsvpCounts.ABSENT} absent{rsvpCounts.ABSENT > 1 ? "s" : ""}</span>}
              </div>
            )}
          </div>

          {/* List */}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-11 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : typed.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Aucun membre actif dans l&apos;association.
            </p>
          ) : (
            <div className="divide-y rounded-lg border overflow-hidden">
              {typed.map(row => (
                <button
                  key={row.membreId}
                  type="button"
                  onClick={() => handleToggle(row)}
                  disabled={pendingIds.has(row.membreId)}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors",
                    row.present
                      ? "bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-950/50"
                      : "bg-background hover:bg-muted/50",
                  )}
                >
                  <span className={cn("font-medium", row.present && "text-green-700 dark:text-green-400")}>
                    {row.lastName} {row.firstName}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {row.rsvp && (
                      <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", RSVP_LABELS[row.rsvp].classes)}>
                        {RSVP_LABELS[row.rsvp].label}
                      </span>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={<span />} className={cn(
                          "flex items-center justify-center size-6 rounded-full transition-colors",
                          row.present
                            ? "bg-green-500 text-white"
                            : "border-2 border-muted-foreground/25 hover:border-muted-foreground/50",
                        )}>
                          {row.present && <CheckIcon className="size-3.5" />}
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {row.present ? "Présent — cliquer pour retirer" : "Absent — cliquer pour marquer présent"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* QR modal */}
      <Modal open={qrOpen} onOpenChange={setQrOpen} title="QR Code de check-in" size="sm">
        <div className="space-y-4">
          {qrValid ? (
            <>
              <div className="flex justify-center py-2">
                <div className="p-4 rounded-xl border bg-white">
                  <QRCodeSVG value={checkInUrl} size={200} />
                </div>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Expire le {format(new Date(qrExpiresAt!), "dd MMM yyyy à HH:mm", { locale: fr })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => { navigator.clipboard.writeText(checkInUrl); toast.success("Lien copié") }}
                >
                  Copier le lien
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<span />}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateQr}
                        loading={generateQr.isPending}
                      >
                        <RefreshCwIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Régénérer — nouveau QR, valide 24h</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<span />}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={handleRevokeQr}
                        loading={revokeQr.isPending}
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Révoquer — désactiver le QR sans en créer un nouveau</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </>
          ) : (
            <div className="text-center space-y-3 py-4">
              <QrCodeIcon className="size-12 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {qrToken && qrExpired ? "Le QR Code a expiré." : "Aucun QR Code actif pour cet événement."}
              </p>
              <Button onClick={handleGenerateQr} loading={generateQr.isPending}>
                <QrCodeIcon className="mr-1.5 size-4" />
                Générer un QR Code
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
