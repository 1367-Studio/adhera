"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { useFactureDetail, useRemoveFacturePayment } from "@/hooks/use-factures"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"

type Payment = { id: string; amount: string; method: string; paidAt: string; note: string | null }

const fmt = (n: number | string) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

interface Props {
  factureId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FacturePaymentsModal({ factureId, open, onOpenChange }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null)
  const { data: facture, isLoading } = useFactureDetail(open ? factureId : "")
  const removeMutation = useRemoveFacturePayment(factureId)

  const payments = (facture?.payments ?? []) as Payment[]

  async function handleRemove() {
    if (!deleteTarget) return
    try {
      await removeMutation.mutateAsync(deleteTarget.id)
      toast.success("Paiement supprimé")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title="Historique des paiements" size="md">
        {isLoading || !facture ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucun paiement enregistré</p>
        ) : (
          <div className="space-y-2">
            {payments.map(p => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm">
                <div>
                  <p className="font-medium tabular-nums">{fmt(p.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.method} · {format(new Date(p.paidAt), "dd/MM/yyyy", { locale: fr })}
                    {p.note && <> · {p.note}</>}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(p)} title="Supprimer ce paiement">
                  <TrashIcon className="size-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer ce paiement ?"
        description={deleteTarget ? `Le paiement de ${fmt(deleteTarget.amount)} sera retiré et le statut de la facture recalculé.` : ""}
        confirmLabel="Supprimer"
        loading={removeMutation.isPending}
        onConfirm={handleRemove}
      />
    </>
  )
}
