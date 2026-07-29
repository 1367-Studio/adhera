"use client"

import { useEffect } from "react"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { bankAccountSchema, type BankAccountInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"

interface BankAccountFormProps {
  defaultValues?: Partial<BankAccountInput>
  onSubmit:  (data: BankAccountInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
}

export function BankAccountForm({ defaultValues, onSubmit, onCancel, loading }: BankAccountFormProps) {
  const t = useTranslations()

  const currencyOptions = [
    { value: "EUR", label: t("finances.bankAccountForm.currencies.eur") },
    { value: "USD", label: t("finances.bankAccountForm.currencies.usd") },
    { value: "BRL", label: t("finances.bankAccountForm.currencies.brl") },
    { value: "CHF", label: t("finances.bankAccountForm.currencies.chf") },
    { value: "GBP", label: t("finances.bankAccountForm.currencies.gbp") },
  ]

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<BankAccountInput>({
    resolver: zodResolver(bankAccountSchema) as Resolver<BankAccountInput>,
    defaultValues: { currency: "EUR", openingBalance: 0, isActive: true, ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ currency: "EUR", openingBalance: 0, isActive: true, ...defaultValues })
  }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t("finances.bankAccountForm.bankName")} required placeholder={t("finances.bankAccountForm.bankNamePlaceholder")} error={errors.bankName?.message} {...register("bankName")} />
        <FormField label={t("finances.bankAccountForm.accountName")}    required placeholder={t("finances.bankAccountForm.accountNamePlaceholder")}  error={errors.accountName?.message} {...register("accountName")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label={t("finances.bankAccountForm.ibanLast4")} placeholder="Ex: 4242" maxLength={4} error={errors.ibanLast4?.message} {...register("ibanLast4")} />
        <Controller
          name="currency"
          control={control}
          render={({ field }) => (
            <SelectField label={t("finances.bankAccountForm.currency")} options={currencyOptions} value={field.value} onValueChange={field.onChange} error={errors.currency?.message} />
          )}
        />
      </div>

      <Controller
        name="openingBalance"
        control={control}
        render={({ field }) => (
          <CurrencyField label={t("finances.bankAccountForm.openingBalance")} value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.openingBalance?.message} />
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
