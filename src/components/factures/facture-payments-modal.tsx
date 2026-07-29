"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
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
  const t = useTranslations()
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null)
  const { data: facture, isLoading } = useFactureDetail(open ? factureId : "")
  const removeMutation = useRemoveFacturePayment(factureId)

  const payments = (facture?.payments ?? []) as Payment[]

  async function handleRemove() {
    if (!deleteTarget) return
    try {
      await removeMutation.mutateAsync(deleteTarget.id)
      toast.success(t("factures.payment.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title={t("factures.payment.historyTitle")} size="md">
        {isLoading || !facture ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("documents.loading")}</p>
        ) : payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("factures.payment.noPayments")}</p>
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
                <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(p)} title={t("factures.payment.deleteTooltip")}>
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
        title={t("factures.payment.deleteConfirmTitle")}
        description={deleteTarget ? t("factures.payment.deleteConfirmDescription", { amount: fmt(deleteTarget.amount) }) : ""}
        confirmLabel={t("common.delete")}
        loading={removeMutation.isPending}
        onConfirm={handleRemove}
      />
    </>
  )
}
