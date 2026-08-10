"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format, formatDistanceStrict } from "date-fns"
import { fr } from "date-fns/locale"
import Link from "next/link"
import { PlusIcon, CheckIcon, TrashIcon, PencilSimpleIcon, MapPinIcon, HashIcon, PackageIcon, WarningCircleIcon, XIcon, ClockIcon, ArrowElbowDownLeftIcon, FilePdfIcon, EnvelopeSimpleIcon, ReceiptIcon, InfoIcon } from "@phosphor-icons/react/dist/ssr";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SendEmailModal } from "@/components/ui/send-email-modal"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMaterialDetail, useReturnLoan, useConfirmLoan, useRefuseLoan, useDeleteLoan, useDeleteMaterial, useSendLoanEmail, useGenerateLoanFacture, type Material, type MaterialLoan } from "@/hooks/use-materiel"
import { LoanModal } from "@/components/materiel/loan-modal"
import { MaterialModal } from "@/components/materiel/material-modal"
import { cn } from "@/lib/utils"
import { BASE_PATH } from "@/lib/env"
import { useCurrentUser, useModules } from "@/lib/user-context"

const FINANCE_ROLES = ["ADMIN", "PRESIDENT", "TRESORIER"]

type Translator = ReturnType<typeof useTranslations>

function getStatusConfig(t: Translator) {
  return {
    DISPONIBLE:     { label: t("materiel.form.status.disponible"),     classes: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    EN_USE:         { label: t("materiel.form.status.enUse"),         classes: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    EN_MAINTENANCE: { label: t("materiel.form.status.enMaintenance"), classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    HORS_SERVICE:   { label: t("materiel.form.status.horsService"),   classes: "bg-muted text-muted-foreground" },
    PERDU:          { label: t("materiel.form.status.perdu"),         classes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  }
}

// The PDF/e-mail/facture icons on each loan row look interchangeable at a glance but do very
// different things (a throwaway receipt vs. a real, payable invoice) — this spells that out
// once instead of leaving people to guess from a bare icon `title` tooltip.
function LoanActionsHelp() {
  const t = useTranslations("materiel.detailSheet")
  return (
    <Tooltip>
      <TooltipTrigger className="text-muted-foreground hover:text-foreground" aria-label={t("helpAriaLabel")}>
        <InfoIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="right" className="flex-col items-start gap-1.5 max-w-64 text-left whitespace-normal">
        <p className="flex items-start gap-1.5"><FilePdfIcon className="size-3 shrink-0 mt-0.5" /><span><strong>{t("helpPdfLabel")}</strong> {t("helpPdfDesc")}</span></p>
        <p className="flex items-start gap-1.5"><EnvelopeSimpleIcon className="size-3 shrink-0 mt-0.5" /><span><strong>{t("helpEmailLabel")}</strong> {t("helpEmailDesc")}</span></p>
        <p className="flex items-start gap-1.5"><ReceiptIcon className="size-3 shrink-0 mt-0.5" /><span><strong>{t("helpFactureLabel")}</strong> {t("helpFactureDesc")}</span></p>
      </TooltipContent>
    </Tooltip>
  )
}

function borrowerLabel(loan: MaterialLoan): string {
  if (loan.membre) return `${loan.membre.firstName} ${loan.membre.lastName}`
  return loan.borrowerName ?? "—"
}

function isOverdue(loan: MaterialLoan): boolean {
  return !!loan.expectedReturnAt && !loan.returnedAt && new Date(loan.expectedReturnAt) < new Date()
}

function isReserved(loan: MaterialLoan): boolean {
  return !loan.returnedAt && new Date(loan.borrowedAt) > new Date()
}

const fmtEUR = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

// feeAmount is a per-unit rate — the amount actually billed (see the facture route) is
// feeAmount × quantity, so any display of it must multiply too or it misleads the reader.
function loanFeeLabel(loan: MaterialLoan): string | null {
  const unit = Number(loan.feeAmount ?? 0)
  if (unit <= 0) return null
  if (loan.quantity <= 1) return fmtEUR(unit)
  return `${loan.quantity} × ${fmtEUR(unit)} = ${fmtEUR(unit * loan.quantity)}`
}

function getFactureStatusLabel(t: Translator): Record<string, string> {
  return {
    BROUILLON: t("factures.form.status.brouillon"), EN_ATTENTE: t("factures.form.status.enAttente"),
    PARTIELLEMENT_PAYEE: t("materiel.detailSheet.factureStatusPartial"),
    PAYEE: t("factures.form.status.payee"), EN_RETARD: t("factures.view.status.enRetard"),
    ANNULEE: t("factures.form.status.annulee"),
  }
}

function FactureAction({ loan, onGenerate, pending, canGenerate }: { loan: MaterialLoan; onGenerate: () => void; pending: boolean; canGenerate: boolean }) {
  const t = useTranslations()
  const FACTURE_STATUS_LABEL = getFactureStatusLabel(t)
  // Factures being disabled for the association hides this entirely, existing invoice or
  // not — same convention as the Devis/Fournisseur module gating (see modules.factures there).
  const modules = useModules()
  if (!modules.factures) return null
  if (loan.facture) {
    return (
      <Link
        href={`/dashboard/factures?search=${encodeURIComponent(loan.facture.number)}`}
        className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
        title={t("materiel.detailSheet.viewFactureTitle", { number: loan.facture.number })}
      >
        <ReceiptIcon className="size-3" /> {loan.facture.number} · {FACTURE_STATUS_LABEL[loan.facture.status] ?? loan.facture.status}
      </Link>
    )
  }
  // Facture generation is finance-only server-side (POST .../facture) — hide the trigger for
  // other roles instead of letting them hit a dead-end "Unauthorized" toast.
  if (!canGenerate) return null
  if (Number(loan.feeAmount ?? 0) <= 0) return null
  return (
    <button
      type="button"
      onClick={onGenerate}
      disabled={pending}
      className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
      title={t("materiel.detailSheet.generateFactureTitle")}
    >
      <ReceiptIcon className="size-3" /> {t("materiel.detailSheet.generateFacture")}
    </button>
  )
}

interface Props {
  material:     Material | null
  open:         boolean
  onOpenChange: (open: boolean) => void
  onDeleted:    () => void
}

export function MaterialDetailSheet({ material, open, onOpenChange, onDeleted }: Props) {
  const t = useTranslations()
  const { role } = useCurrentUser()
  const canGenerateFacture = FINANCE_ROLES.includes(role)
  const { data: detail, isLoading } = useMaterialDetail(material?.id ?? null)
  const returnLoan  = useReturnLoan(material?.id  ?? "")
  const confirmLoan = useConfirmLoan(material?.id ?? "")
  const refuseLoan  = useRefuseLoan(material?.id  ?? "")
  const deleteLoan  = useDeleteLoan(material?.id  ?? "")
  const deleteMat   = useDeleteMaterial()
  const sendLoanEmail = useSendLoanEmail(material?.id ?? "")
  const generateFacture = useGenerateLoanFacture(material?.id ?? "")

  const [loanModalOpen,   setLoanModalOpen]   = useState(false)
  const [editModalOpen,   setEditModalOpen]   = useState(false)
  const [deletingLoan,    setDeletingLoan]    = useState<MaterialLoan | null>(null)
  const [confirmDelete,   setConfirmDelete]   = useState(false)
  const [emailTarget,     setEmailTarget]     = useState<MaterialLoan | null>(null)

  const pendingLoans = detail?.loans.filter(l => !l.returnedAt && l.status === "DEMANDE") ?? []
  const activeLoans  = detail?.loans.filter(l => !l.returnedAt && l.status === "CONFIRME") ?? []
  const refusedLoans = detail?.loans.filter(l => l.status === "REFUSE") ?? [] // Fix 3
  const history      = detail?.loans.filter(l =>  l.returnedAt) ?? []

  async function handleReturn(loan: MaterialLoan) {
    try {
      await returnLoan.mutateAsync(loan.id)
      toast.success(t("materiel.detailSheet.toasts.returned"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleSendLoanEmail(to: string, message: string) {
    if (!emailTarget) return
    try {
      await sendLoanEmail.mutateAsync({ loanId: emailTarget.id, to, message })
      toast.success(t("materiel.detailSheet.toasts.emailSent"))
      setEmailTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleGenerateFacture(loan: MaterialLoan) {
    try {
      await generateFacture.mutateAsync(loan.id)
      toast.success(t("materiel.detailSheet.toasts.factureGenerated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDeleteLoan() {
    if (!deletingLoan) return
    try {
      await deleteLoan.mutateAsync(deletingLoan.id)
      toast.success(t("materiel.detailSheet.toasts.loanDeleted"))
      setDeletingLoan(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDeleteMaterial() {
    if (!material) return
    try {
      await deleteMat.mutateAsync(material.id)
      toast.success(t("materiel.detailSheet.toasts.materialDeleted", { name: material.name }))
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const effectiveStatus = detail?.status ?? material?.status
  const STATUS_CONFIG = getStatusConfig(t)
  const cfg = effectiveStatus ? STATUS_CONFIG[effectiveStatus] : null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0 overflow-hidden">
          <SheetHeader className="px-5 pt-10 pb-4 border-b shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-base font-semibold truncate">{detail?.name ?? material?.name}</SheetTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {(detail?.category ?? material?.category) && (
                    <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5">{detail?.category ?? material?.category}</span>
                  )}
                  {cfg && (
                    <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", cfg.classes)}>{cfg.label}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setEditModalOpen(true)}>
                  <PencilSimpleIcon className="size-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
                  <TrashIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-5 space-y-3">
                {[0,1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : detail ? (
              <div className="divide-y">
                {detail.imageUrl && (
                  <div className="relative aspect-video overflow-hidden">
                    <img src={detail.imageUrl} aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" />
                    <img src={detail.imageUrl} alt="" className="absolute inset-0 w-full h-full object-contain z-10" />
                  </div>
                )}
                {/* Info grid */}
                <div className="px-5 py-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <PackageIcon className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">{t("materiel.detailSheet.infoGrid.quantity")}</span>
                    <span className="font-medium ml-auto">
                      {t("materiel.detailSheet.infoGrid.availableOf", { available: detail.availableQty, total: detail.quantity })}
                    </span>
                  </div>
                  {detail.location && (
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">{t("materiel.detailSheet.infoGrid.location")}</span>
                      <span className="font-medium ml-auto truncate">{detail.location}</span>
                    </div>
                  )}
                  {detail.serialNumber && (
                    <div className="flex items-center gap-2 col-span-2">
                      <HashIcon className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">{t("materiel.detailSheet.infoGrid.reference")}</span>
                      <span className="font-mono text-xs ml-auto">{detail.serialNumber}</span>
                    </div>
                  )}
                  {detail.purchaseDate && (
                    <div className="text-muted-foreground col-span-2 text-xs">
                      {t("materiel.detailSheet.infoGrid.acquiredOn", { date: format(new Date(detail.purchaseDate), "d MMM yyyy", { locale: fr }) })}
                      {detail.purchasePrice && ` · ${Number(detail.purchasePrice).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`}
                    </div>
                  )}
                  {detail.rentalRate && (
                    <div className="text-muted-foreground col-span-2 text-xs">
                      {t("materiel.detailSheet.infoGrid.defaultRate", { amount: Number(detail.rentalRate).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) })}
                    </div>
                  )}
                  {detail.financeCategory && (
                    <div className="text-muted-foreground col-span-2 text-xs">
                      {t("materiel.detailSheet.infoGrid.accountingCategory", { name: detail.financeCategory.name })}
                    </div>
                  )}
                  {detail.description && (
                    <p className="col-span-2 text-xs text-muted-foreground">{detail.description}</p>
                  )}
                  {detail.notes && (
                    <p className="col-span-2 text-xs text-muted-foreground italic">{detail.notes}</p>
                  )}
                </div>

                {/* Pending demands */}
                {pendingLoans.length > 0 && (
                  <div className="px-5 py-4 space-y-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <ClockIcon className="size-3.5 text-amber-500" />
                      {t("materiel.detailSheet.pendingSection.heading")}
                      <span className="text-muted-foreground font-normal">({pendingLoans.length})</span>
                    </h3>
                    <div className="space-y-2">
                      {pendingLoans.map(loan => (
                        <div key={loan.id} className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20 px-3 py-2.5 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">
                              {loan.membre ? `${loan.membre.firstName} ${loan.membre.lastName}` : loan.borrowerName ?? "—"}
                              {loan.quantity > 1 && <span className="text-muted-foreground ml-1">×{loan.quantity}</span>}
                            </p>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={confirmLoan.isPending || refuseLoan.isPending}
                                onClick={async () => {
                                  try { await confirmLoan.mutateAsync(loan.id); toast.success(t("materiel.detailSheet.toasts.loanConfirmed")) }
                                  catch (err) { toast.error(err instanceof Error ? err.message : t("common.error")) }
                                }}
                                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <CheckIcon className="size-3" /> {t("materiel.detailSheet.pendingSection.accept")}
                              </button>
                              <button
                                type="button"
                                disabled={confirmLoan.isPending || refuseLoan.isPending}
                                onClick={async () => {
                                  try { await refuseLoan.mutateAsync(loan.id); toast.success(t("materiel.detailSheet.toasts.loanRefused")) }
                                  catch (err) { toast.error(err instanceof Error ? err.message : t("common.error")) }
                                }}
                                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <XIcon className="size-3" /> {t("materiel.detailSheet.pendingSection.refuse")}
                              </button>
                            </div>
                          </div>
                          {loan.expectedReturnAt && (
                            <p className="text-xs text-muted-foreground">
                              {t("materiel.detailSheet.pendingSection.returnExpected", { date: format(new Date(loan.expectedReturnAt), "d MMM yyyy", { locale: fr }) })}
                            </p>
                          )}
                          {loan.notes && <p className="text-xs text-muted-foreground italic">{loan.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active loans */}
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                      {t("materiel.detailSheet.activeSection.heading")}
                      {activeLoans.length > 0 && <span className="ml-1.5 text-muted-foreground font-normal">({activeLoans.length})</span>}
                      <LoanActionsHelp />
                    </h3>
                    {/* Not gated on availableQty === 0 — that reflects only today's stock, but
                        the modal still lets you register a future-dated reservation for an
                        item that's fully out today and free again by then. */}
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setLoanModalOpen(true)}>
                      <PlusIcon className="size-3 mr-1" /> {t("materiel.detailSheet.activeSection.lend")}
                    </Button>
                  </div>

                  {activeLoans.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">{t("materiel.detailSheet.activeSection.noActiveLoans")}</p>
                  ) : (
                    <div className="space-y-2">
                      {activeLoans.map(loan => {
                        const reserved = isReserved(loan)
                        return (
                        <div key={loan.id} className={cn(
                          "rounded-lg border px-3 py-2.5 space-y-1",
                          reserved && "border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20",
                          isOverdue(loan) && "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20",
                        )}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium flex items-center gap-1.5">
                              {borrowerLabel(loan)}{loan.quantity > 1 && <span className="text-muted-foreground ml-1">×{loan.quantity}</span>}
                              {reserved && (
                                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                  {t("materiel.detailSheet.activeSection.reservedBadge")}
                                </span>
                              )}
                            </p>
                            <div className="flex items-center gap-1">
                              {isOverdue(loan) && <WarningCircleIcon className="size-3.5 text-red-500" />}
                              <button type="button" onClick={() => window.open(`${BASE_PATH}/api/materiel/${material?.id}/loans/${loan.id}/pdf`, "_blank")} className="text-muted-foreground hover:text-foreground transition-colors" title={t("materiel.detailSheet.activeSection.pdfTitle")}>
                                <FilePdfIcon className="size-3.5" />
                              </button>
                              <button type="button" onClick={() => setEmailTarget(loan)} className="text-muted-foreground hover:text-foreground transition-colors" title={t("materiel.detailSheet.activeSection.emailTitle")}>
                                <EnvelopeSimpleIcon className="size-3.5" />
                              </button>
                              <button type="button" onClick={() => handleReturn(loan)} disabled={returnLoan.isPending || reserved} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title={reserved ? t("materiel.detailSheet.activeSection.notYetOutTitle") : t("materiel.detailSheet.activeSection.markReturnedTitle")}>
                                <ArrowElbowDownLeftIcon className="size-3" /> {t("materiel.detailSheet.activeSection.returned")}
                              </button>
                              {/* Deleting a loan with a facture is rejected server-side (it would
                                  orphan the invoice) — hide the trigger instead of a dead-end error. */}
                              {!loan.facture && (
                                <button type="button" onClick={() => setDeletingLoan(loan)} className="text-muted-foreground hover:text-destructive transition-colors" title={t("materiel.detailSheet.activeSection.deleteTitle")}>
                                  <TrashIcon className="size-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {reserved ? t("materiel.detailSheet.activeSection.reservedFor") : t("materiel.detailSheet.activeSection.goneOn")}{format(new Date(loan.borrowedAt), "d MMM yyyy", { locale: fr })}
                            {loan.expectedReturnAt && (
                              <span className={cn(isOverdue(loan) && "text-red-600 font-medium")}>
                                {t("materiel.detailSheet.activeSection.returnExpected")}{format(new Date(loan.expectedReturnAt), "d MMM yyyy", { locale: fr })}
                                {isOverdue(loan) && t("materiel.detailSheet.activeSection.overdue")}
                              </span>
                            )}
                            {loanFeeLabel(loan) && ` · ${loanFeeLabel(loan)}`}
                          </p>
                          {loan.notes && <p className="text-xs text-muted-foreground italic">{loan.notes}</p>}
                          <FactureAction loan={loan} onGenerate={() => handleGenerateFacture(loan)} pending={generateFacture.isPending} canGenerate={canGenerateFacture} />
                        </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* History + Refused (Fix 3) */}
                {(history.length > 0 || refusedLoans.length > 0) && (
                  <div className="px-5 py-4 space-y-2">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      {t("materiel.detailSheet.historySection.heading", { count: history.length + refusedLoans.length })}
                    </h3>
                    <div className="space-y-1.5">
                      {refusedLoans.map(loan => (
                        <div key={loan.id} className="flex items-center justify-between gap-3 text-xs py-1.5 border-b last:border-0">
                          <div className="min-w-0">
                            <span className="font-medium">{borrowerLabel(loan)}</span>
                            {loan.quantity > 1 && <span className="text-muted-foreground ml-1">×{loan.quantity}</span>}
                            <span className="text-muted-foreground ml-2">
                              {t("materiel.detailSheet.historySection.requestedOn", { date: format(new Date(loan.borrowedAt), "d MMM yy", { locale: fr }) })}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-destructive/10 dark:bg-destructive/25 text-destructive">
                            {t("materiel.detailSheet.historySection.refusedBadge")}
                          </span>
                        </div>
                      ))}
                      {history.map(loan => (
                        <div key={loan.id} className="flex items-center justify-between gap-3 text-xs py-1.5 border-b last:border-0">
                          <div className="min-w-0">
                            <span className="font-medium">{borrowerLabel(loan)}</span>
                            {loan.quantity > 1 && <span className="text-muted-foreground ml-1">×{loan.quantity}</span>}
                            <span className="text-muted-foreground ml-2">
                              {format(new Date(loan.borrowedAt), "d MMM yy", { locale: fr })}
                              {" → "}
                              {format(new Date(loan.returnedAt!), "d MMM yy", { locale: fr })}
                              {" · "}
                              {formatDistanceStrict(new Date(loan.returnedAt!), new Date(loan.borrowedAt), { locale: fr })}
                              {loanFeeLabel(loan) && ` · ${loanFeeLabel(loan)}`}
                            </span>
                            <div className="mt-1">
                              <FactureAction loan={loan} onGenerate={() => handleGenerateFacture(loan)} pending={generateFacture.isPending} canGenerate={canGenerateFacture} />
                            </div>
                          </div>
                          {!loan.facture && (
                            <button type="button" onClick={() => setDeletingLoan(loan)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                              <TrashIcon className="size-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {detail && (
        <LoanModal
          open={loanModalOpen}
          onOpenChange={setLoanModalOpen}
          material={{ ...material!, ...detail }}
        />
      )}

      {material && (
        <MaterialModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          material={material}
        />
      )}

      <ConfirmDialog
        open={!!deletingLoan}
        onOpenChange={open => !open && setDeletingLoan(null)}
        title={t("materiel.detailSheet.deleteLoanConfirm.title")}
        description={deletingLoan?.returnedAt
          ? t("materiel.detailSheet.deleteLoanConfirm.descriptionHistory")
          : t("materiel.detailSheet.deleteLoanConfirm.descriptionActive")}
        confirmLabel={t("common.delete")}
        loading={deleteLoan.isPending}
        onConfirm={handleDeleteLoan}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("materiel.detailSheet.deleteMaterialConfirm.title", { name: detail?.name ?? material?.name ?? "" })}
        description={
          // The API refuses to delete a material with active loans (409) — say so up front
          // instead of promising a deletion that will actually fail.
          activeLoans.length > 0
            ? t("materiel.detailSheet.deleteMaterialConfirm.descriptionBlocked", { count: activeLoans.length })
            : `${t("materiel.detailSheet.deleteMaterialConfirm.descriptionConfirmed")}${
                pendingLoans.length > 0
                  ? t("materiel.detailSheet.deleteMaterialConfirm.descriptionPendingWarning", { count: pendingLoans.length })
                  : ""
              }`
        }
        confirmLabel={t("common.delete")}
        confirmDisabled={activeLoans.length > 0}
        loading={deleteMat.isPending}
        onConfirm={handleDeleteMaterial}
      />

      {emailTarget && (
        <SendEmailModal
          documentLabel={t("materiel.detailSheet.emailModal.documentLabel")}
          defaultTo={emailTarget.membre?.email ?? ""}
          open={!!emailTarget}
          onOpenChange={open => !open && setEmailTarget(null)}
          onSend={handleSendLoanEmail}
          loading={sendLoanEmail.isPending}
        />
      )}
    </>
  )
}
