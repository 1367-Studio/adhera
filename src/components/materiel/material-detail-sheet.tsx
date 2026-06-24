"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format, formatDistanceStrict } from "date-fns"
import { fr } from "date-fns/locale"
import {
  PlusIcon, CheckIcon, Trash2Icon, PencilIcon,
  MapPinIcon, HashIcon, PackageIcon, AlertCircleIcon,
  XIcon, ClockIcon, CornerDownLeftIcon,
} from "lucide-react"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useMaterialDetail, useReturnLoan, useConfirmLoan, useRefuseLoan, useDeleteLoan, useDeleteMaterial, type Material, type MaterialLoan } from "@/hooks/use-materiel"
import { LoanModal } from "@/components/materiel/loan-modal"
import { MaterialModal } from "@/components/materiel/material-modal"
import { cn } from "@/lib/utils"

const STATUS_CONFIG = {
  DISPONIBLE:     { label: "Disponible",      classes: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  EN_USE:         { label: "En utilisation",  classes: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  EN_MAINTENANCE: { label: "En maintenance",  classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  HORS_SERVICE:   { label: "Hors service",    classes: "bg-muted text-muted-foreground" },
  PERDU:          { label: "Perdu",           classes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
}

function borrowerLabel(loan: MaterialLoan): string {
  if (loan.membre) return `${loan.membre.firstName} ${loan.membre.lastName}`
  return loan.borrowerName ?? "—"
}

function isOverdue(loan: MaterialLoan): boolean {
  return !!loan.expectedReturnAt && !loan.returnedAt && new Date(loan.expectedReturnAt) < new Date()
}

interface Props {
  material:     Material | null
  open:         boolean
  onOpenChange: (open: boolean) => void
  onDeleted:    () => void
}

export function MaterialDetailSheet({ material, open, onOpenChange, onDeleted }: Props) {
  const { data: detail, isLoading } = useMaterialDetail(material?.id ?? null)
  const returnLoan  = useReturnLoan(material?.id  ?? "")
  const confirmLoan = useConfirmLoan(material?.id ?? "")
  const refuseLoan  = useRefuseLoan(material?.id  ?? "")
  const deleteLoan  = useDeleteLoan(material?.id  ?? "")
  const deleteMat   = useDeleteMaterial()

  const [loanModalOpen,   setLoanModalOpen]   = useState(false)
  const [editModalOpen,   setEditModalOpen]   = useState(false)
  const [deletingLoan,    setDeletingLoan]    = useState<MaterialLoan | null>(null)
  const [confirmDelete,   setConfirmDelete]   = useState(false)

  const pendingLoans = detail?.loans.filter(l => !l.returnedAt && l.status === "DEMANDE") ?? []
  const activeLoans  = detail?.loans.filter(l => !l.returnedAt && l.status === "CONFIRME") ?? []
  const refusedLoans = detail?.loans.filter(l => l.status === "REFUSE") ?? [] // Fix 3
  const history      = detail?.loans.filter(l =>  l.returnedAt) ?? []

  async function handleReturn(loan: MaterialLoan) {
    try {
      await returnLoan.mutateAsync(loan.id)
      toast.success("Retour enregistré")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDeleteLoan() {
    if (!deletingLoan) return
    try {
      await deleteLoan.mutateAsync(deletingLoan.id)
      toast.success("Prêt supprimé")
      setDeletingLoan(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDeleteMaterial() {
    if (!material) return
    try {
      await deleteMat.mutateAsync(material.id)
      toast.success(`« ${material.name} » supprimé`)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const effectiveStatus = detail?.status ?? material?.status
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
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", cfg.classes)}>{cfg.label}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setEditModalOpen(true)}>
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
                  <Trash2Icon className="size-3.5" />
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
                {/* Info grid */}
                <div className="px-5 py-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <PackageIcon className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Quantité</span>
                    <span className="font-medium ml-auto">
                      {detail.availableQty}/{detail.quantity} dispo.
                    </span>
                  </div>
                  {detail.location && (
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">Emplacement</span>
                      <span className="font-medium ml-auto truncate">{detail.location}</span>
                    </div>
                  )}
                  {detail.serialNumber && (
                    <div className="flex items-center gap-2 col-span-2">
                      <HashIcon className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">Réf.</span>
                      <span className="font-mono text-xs ml-auto">{detail.serialNumber}</span>
                    </div>
                  )}
                  {detail.purchaseDate && (
                    <div className="text-muted-foreground col-span-2 text-xs">
                      Acquis le {format(new Date(detail.purchaseDate), "d MMM yyyy", { locale: fr })}
                      {detail.purchasePrice && ` · ${Number(detail.purchasePrice).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`}
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
                      Demandes en attente
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
                                  try { await confirmLoan.mutateAsync(loan.id); toast.success("Emprunt confirmé") }
                                  catch (err) { toast.error(err instanceof Error ? err.message : "Erreur") }
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <CheckIcon className="size-3" /> Accepter
                              </button>
                              <button
                                type="button"
                                disabled={confirmLoan.isPending || refuseLoan.isPending}
                                onClick={async () => {
                                  try { await refuseLoan.mutateAsync(loan.id); toast.success("Demande refusée") }
                                  catch (err) { toast.error(err instanceof Error ? err.message : "Erreur") }
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <XIcon className="size-3" /> Refuser
                              </button>
                            </div>
                          </div>
                          {loan.expectedReturnAt && (
                            <p className="text-[11px] text-muted-foreground">
                              Retour prévu le {format(new Date(loan.expectedReturnAt), "d MMM yyyy", { locale: fr })}
                            </p>
                          )}
                          {loan.notes && <p className="text-[11px] text-muted-foreground italic">{loan.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active loans */}
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      Prêts en cours
                      {activeLoans.length > 0 && <span className="ml-1.5 text-muted-foreground font-normal">({activeLoans.length})</span>}
                    </h3>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setLoanModalOpen(true)} disabled={detail.availableQty === 0}>
                      <PlusIcon className="size-3 mr-1" /> Prêter
                    </Button>
                  </div>

                  {activeLoans.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">Aucun prêt en cours.</p>
                  ) : (
                    <div className="space-y-2">
                      {activeLoans.map(loan => (
                        <div key={loan.id} className={cn(
                          "rounded-lg border px-3 py-2.5 space-y-1",
                          isOverdue(loan) && "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20",
                        )}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{borrowerLabel(loan)}{loan.quantity > 1 && <span className="text-muted-foreground ml-1">×{loan.quantity}</span>}</p>
                            <div className="flex items-center gap-1">
                              {isOverdue(loan) && <AlertCircleIcon className="size-3.5 text-red-500" />}
                              <button type="button" onClick={() => handleReturn(loan)} disabled={returnLoan.isPending} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Marquer comme rendu">
                                <CornerDownLeftIcon className="size-3" /> Rendu
                              </button>
                              <button type="button" onClick={() => setDeletingLoan(loan)} className="text-muted-foreground hover:text-destructive transition-colors" title="Supprimer">
                                <Trash2Icon className="size-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Sorti le {format(new Date(loan.borrowedAt), "d MMM yyyy", { locale: fr })}
                            {loan.expectedReturnAt && (
                              <span className={cn(isOverdue(loan) && "text-red-600 font-medium")}>
                                {" · Retour prévu "}{format(new Date(loan.expectedReturnAt), "d MMM yyyy", { locale: fr })}
                                {isOverdue(loan) && " (en retard)"}
                              </span>
                            )}
                          </p>
                          {loan.notes && <p className="text-[11px] text-muted-foreground italic">{loan.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* History + Refused (Fix 3) */}
                {(history.length > 0 || refusedLoans.length > 0) && (
                  <div className="px-5 py-4 space-y-2">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      Historique ({history.length + refusedLoans.length})
                    </h3>
                    <div className="space-y-1.5">
                      {refusedLoans.map(loan => (
                        <div key={loan.id} className="flex items-center justify-between gap-3 text-xs py-1.5 border-b last:border-0">
                          <div className="min-w-0">
                            <span className="font-medium">{borrowerLabel(loan)}</span>
                            {loan.quantity > 1 && <span className="text-muted-foreground ml-1">×{loan.quantity}</span>}
                            <span className="text-muted-foreground ml-2">
                              demande du {format(new Date(loan.borrowedAt), "d MMM yy", { locale: fr })}
                            </span>
                          </div>
                          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">
                            Refusé
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
                            </span>
                          </div>
                          <button type="button" onClick={() => setDeletingLoan(loan)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                            <Trash2Icon className="size-3" />
                          </button>
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
        title="Supprimer ce prêt ?"
        description={deletingLoan?.returnedAt
          ? "L'entrée sera supprimée de l'historique."
          : "Le prêt actif sera supprimé sans enregistrer de date de retour."}
        confirmLabel="Supprimer"
        loading={deleteLoan.isPending}
        onConfirm={handleDeleteLoan}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer « ${detail?.name ?? material?.name} » ?`}
        description={`L'article et tout son historique de prêts seront supprimés définitivement.${
          (activeLoans.length + pendingLoans.length) > 0
            ? ` Attention : ${[
                activeLoans.length  > 0 && `${activeLoans.length} prêt(s) en cours`,
                pendingLoans.length > 0 && `${pendingLoans.length} demande(s) en attente`,
              ].filter(Boolean).join(" et ")} seront perdus.`
            : ""
        }`}
        confirmLabel="Supprimer"
        loading={deleteMat.isPending}
        onConfirm={handleDeleteMaterial}
      />
    </>
  )
}
