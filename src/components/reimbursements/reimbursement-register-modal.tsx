"use client"

import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { reimbursementRegisterSchema, type ReimbursementRegisterInput } from "@/lib/schemas"
import { Modal } from "@/components/ui/modal"
import { DateField } from "@/components/ui/date-field"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { useBankAccounts } from "@/hooks/use-bank-accounts"
import { useBankTransactions } from "@/hooks/use-bank-transactions"
import { format } from "date-fns"
import { fr } from "date-fns/locale"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: ReimbursementRegisterInput) => Promise<void>
  loading?: boolean
  amount: number
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

export function ReimbursementRegisterModal({ open, onOpenChange, onSubmit, loading, amount }: Props) {
  const t = useTranslations()
  const { data: bankAccounts = [] } = useBankAccounts()

  const paymentMethodOptions = [
    { value: "VIREMENT", label: t("reimbursements.register.methods.virement") },
    { value: "CHEQUE",   label: t("reimbursements.register.methods.cheque")   },
    { value: "ESPECES",  label: t("reimbursements.register.methods.especes")  },
  ]
  const bankAccountOptions = bankAccounts.map((a: { id: string; bankName: string; accountName: string }) => ({
    value: a.id, label: `${a.bankName} — ${a.accountName}`,
  }))

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<ReimbursementRegisterInput>({
    resolver: zodResolver(reimbursementRegisterSchema),
    defaultValues: { date: new Date().toISOString().split("T")[0], paymentMethod: "VIREMENT", bankAccountId: "", reference: "", bankTransactionId: "" },
  })
  const paymentMethod = watch("paymentMethod")
  const bankAccountId = watch("bankAccountId")

  // Reconciling against an already-imported bank transaction, right here at registration —
  // same request the ticket describes ("a transação existente a conciliar, quando aplicável"
  // alongside date/method/account/reference). Scoped to the chosen account's still-UNMATCHED
  // transactions, otherwise the list would mix in every account's history. Can still also be
  // done afterward from the generic Conciliation screen (reconcile/route.ts supports a
  // reimbursementRequestId target) — this is the inline shortcut, not the only path.
  const { data: transactionsPage } = useBankTransactions(1, 50, { status: "UNMATCHED", bankAccountId })
  const transactions = (transactionsPage?.data ?? []) as { id: string; label: string; amount: string; transactionDate: string }[]
  // Closest amount match first — makes the right transaction easy to spot in a list that can
  // otherwise run to dozens of unmatched rows.
  const sortedTransactions = [...transactions].sort(
    (a, b) => Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount),
  )
  const transactionOptions = [
    { value: "", label: t("reimbursements.register.noTransaction") },
    ...sortedTransactions.map(tx => {
      const matches = Math.abs(Number(tx.amount) - amount) < 0.01
      const label = `${format(new Date(tx.transactionDate), "dd/MM/yyyy", { locale: fr })} — ${tx.label} — ${fmt(Number(tx.amount))}`
      return { value: tx.id, label: matches ? `✓ ${label}` : label }
    }),
  ]
  const showTransactionPicker = paymentMethod !== "ESPECES" && !!bankAccountId

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("reimbursements.register.title")} dismissable={false}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Controller
          name="date"
          control={control}
          render={({ field }) => (
            <DateField label={t("reimbursements.register.date")} required value={field.value ?? ""} onChange={field.onChange} error={errors.date?.message} />
          )}
        />

        <Controller
          name="paymentMethod"
          control={control}
          render={({ field }) => (
            <SelectField label={t("reimbursements.register.paymentMethod")} required options={paymentMethodOptions} value={field.value} onValueChange={field.onChange} />
          )}
        />

        {paymentMethod !== "ESPECES" && (
          <div className="space-y-1">
            <Controller
              name="bankAccountId"
              control={control}
              render={({ field }) => (
                <SelectField label={t("reimbursements.register.bankAccount")} required options={bankAccountOptions} value={field.value ?? ""} onValueChange={field.onChange} error={errors.bankAccountId?.message} />
              )}
            />
            {bankAccountOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("reimbursements.register.noBankAccountHint")}</p>
            )}
          </div>
        )}

        {showTransactionPicker && (
          <Controller
            name="bankTransactionId"
            control={control}
            render={({ field }) => (
              <SelectField label={t("reimbursements.register.transaction")} options={transactionOptions} value={field.value ?? ""} onValueChange={field.onChange} />
            )}
          />
        )}

        <FormField label={t("reimbursements.register.reference")} {...register("reference")} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{t("common.cancel")}</Button>
          <Button type="submit" loading={loading}>{t("reimbursements.register.submit")}</Button>
        </div>
      </form>
    </Modal>
  )
}
