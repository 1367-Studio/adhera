"use client"

import { useEffect } from "react"
import { useForm, useWatch, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { accountTransferSchema, type AccountTransferInput } from "@/lib/schemas"
import { DateField } from "@/components/ui/date-field"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"

interface AccountOption {
  id: string
  accountName: string
  bankName: string
  currency: string
}

interface AccountTransferFormProps {
  accounts:       AccountOption[]
  defaultValues?: Partial<AccountTransferInput>
  onSubmit:       (data: AccountTransferInput) => Promise<void>
  onCancel:       () => void
  loading?:       boolean
}

export function AccountTransferForm({ accounts, defaultValues, onSubmit, onCancel, loading }: AccountTransferFormProps) {
  const t = useTranslations()

  const accountsById = new Map(accounts.map(a => [a.id, a]))
  const accountOptions = accounts.map(a => ({ value: a.id, label: `${a.accountName} — ${a.bankName}` }))

  const initialValues = { date: new Date().toISOString().split("T")[0], amount: 0, ...defaultValues }

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<AccountTransferInput>({
    resolver: zodResolver(accountTransferSchema) as Resolver<AccountTransferInput>,
    defaultValues: initialValues,
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ date: new Date().toISOString().split("T")[0], amount: 0, ...defaultValues })
  }, [defaultValues, reset])

  const fromAccountId = useWatch({ control, name: "fromAccountId" })
  // Only an account sharing the source's currency can be the destination — AccountTransfer
  // carries a single amount with no FX conversion, so a cross-currency pick would silently
  // misrepresent the amount on one side. See schema.prisma's AccountTransfer doc comment.
  const fromCurrency = fromAccountId ? accountsById.get(fromAccountId)?.currency : undefined
  const toAccountOptions = accountOptions.filter(o => {
    if (o.value === fromAccountId) return false
    if (!fromCurrency) return true
    return accountsById.get(o.value)?.currency === fromCurrency
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="fromAccountId"
          control={control}
          render={({ field }) => (
            <SelectField label={t("finances.transferForm.fromAccount")} required options={accountOptions} value={field.value ?? ""} onValueChange={field.onChange} error={errors.fromAccountId?.message} />
          )}
        />
        <Controller
          name="toAccountId"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("finances.transferForm.toAccount")} required
              options={toAccountOptions}
              value={field.value ?? ""} onValueChange={field.onChange} error={errors.toAccountId?.message}
            />
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField label={t("finances.transferForm.amount")} required value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.amount?.message} />
          )}
        />
        <Controller
          name="date"
          control={control}
          render={({ field }) => (
            <DateField label={t("finances.transferForm.date")} required value={field.value ?? ""} onChange={field.onChange} error={errors.date?.message} />
          )}
        />
      </div>

      <FormField label={t("finances.transferForm.note")} placeholder={t("finances.transferForm.notePlaceholder")} error={errors.note?.message} {...register("note")} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
