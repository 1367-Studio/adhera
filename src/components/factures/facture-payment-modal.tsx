"use client"

import { useState } from "react"
import { DateField } from "@/components/ui/date-field"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useAddFacturePayment } from "@/hooks/use-factures"
import { Modal } from "@/components/ui/modal"
import { CurrencyField } from "@/components/ui/currency-field"
import { SelectField } from "@/components/ui/select-field"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"

const methodOptions = [
  { value: "Virement",    label: "Virement"     },
  { value: "Espèces",     label: "Espèces"      },
  { value: "Chèque",      label: "Chèque"       },
  { value: "Carte",       label: "Carte"        },
  { value: "Prélèvement", label: "Prélèvement"  },
  { value: "Autre",       label: "Autre"        },
]

interface Props {
  factureId: string
  remaining: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FacturePaymentModal({ factureId, remaining, open, onOpenChange }: Props) {
  const t = useTranslations()
  const [amount, setAmount] = useState(remaining > 0 ? remaining : 0)
  const [method, setMethod] = useState("Virement")
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split("T")[0])
  const [note, setNote]     = useState("")
  const mutation = useAddFacturePayment(factureId)

  async function handleSubmit() {
    if (amount <= 0) {
      toast.error(t("factures.payment.toasts.amountMustBePositive"))
      return
    }
    if (amount > remaining + 0.01) {
      toast.error(t("factures.payment.toasts.amountExceedsBalance", { amount: `${remaining.toFixed(2)} €` }))
      return
    }
    try {
      await mutation.mutateAsync({ amount, method, paidAt, note })
      toast.success(t("factures.payment.toasts.recorded"))
      onOpenChange(false)
      setNote("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("factures.payment.title")} size="sm">
      <div className="space-y-4">
        <div className="space-y-1">
          <CurrencyField label={t("factures.payment.amount")} required value={amount} onChange={setAmount} />
          <p className="text-xs text-muted-foreground">{t("factures.payment.remainingBalance", { amount: `${remaining.toFixed(2)} €` })}</p>
        </div>
        <SelectField label={t("factures.payment.method")} required options={methodOptions} value={method} onValueChange={setMethod} />
        <DateField label={t("factures.payment.date")} value={paidAt} onChange={setPaidAt} />
        <FormField label={t("factures.payment.note")} placeholder={t("factures.payment.notePlaceholder")} value={note} onChange={e => setNote(e.target.value)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} loading={mutation.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
