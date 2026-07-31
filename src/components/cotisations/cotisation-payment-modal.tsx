"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useAddCotisationPayment } from "@/hooks/use-cotisations"
import { Modal } from "@/components/ui/modal"
import { CurrencyField } from "@/components/ui/currency-field"
import { SelectField } from "@/components/ui/select-field"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"

type Method = "CB" | "CHQ" | "ESP" | "En ligne"

const methodOptions: { value: Method; label: string }[] = [
  { value: "CB",       label: "CB"       },
  { value: "CHQ",      label: "CHQ"      },
  { value: "ESP",      label: "ESP"      },
  { value: "En ligne", label: "En ligne" },
]

interface Props {
  cotisationId: string
  remaining: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CotisationPaymentModal({ cotisationId, remaining, open, onOpenChange }: Props) {
  const t = useTranslations()
  const [amount, setAmount] = useState(remaining > 0 ? remaining : 0)
  const [method, setMethod] = useState<Method>("CB")
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split("T")[0])
  const [note, setNote]     = useState("")
  const mutation = useAddCotisationPayment(cotisationId)

  async function handleSubmit() {
    if (amount <= 0) {
      toast.error(t("cotisations.payment.toasts.amountMustBePositive"))
      return
    }
    if (amount > remaining + 0.01) {
      toast.error(t("cotisations.payment.toasts.amountExceedsBalance", { amount: `${remaining.toFixed(2)} €` }))
      return
    }
    try {
      await mutation.mutateAsync({ amount, method, paidAt, note })
      toast.success(t("cotisations.payment.toasts.recorded"))
      onOpenChange(false)
      setNote("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("cotisations.payment.title")} size="sm">
      <div className="space-y-4">
        <div className="space-y-1">
          <CurrencyField label={t("cotisations.payment.amount")} required value={amount} onChange={setAmount} />
          <p className="text-xs text-muted-foreground">{t("cotisations.payment.remainingBalance", { amount: `${remaining.toFixed(2)} €` })}</p>
        </div>
        <SelectField label={t("cotisations.payment.method")} required options={methodOptions} value={method} onValueChange={(v) => setMethod(v as Method)} />
        <FormField label={t("cotisations.payment.date")} type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
        <FormField label={t("cotisations.payment.note")} placeholder={t("cotisations.payment.notePlaceholder")} value={note} onChange={e => setNote(e.target.value)} />
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
