"use client"

import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { immobilisationSchema, type ImmobilisationInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { DateField } from "@/components/ui/date-field"
import { Button } from "@/components/ui/button"
import { useEligibleExpensesForImmobilisation } from "@/hooks/use-immobilisations"

type EligibleExpense = {
  id:          string
  description: string | null
  vendor:      string | null
  amount:      string
  date:        string
}

interface ImmobilisationFormProps {
  onSubmit: (data: ImmobilisationInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function ImmobilisationForm({ onSubmit, onCancel, loading }: ImmobilisationFormProps) {
  const t = useTranslations()
  const { data: eligibleExpenses = [], isLoading: expensesLoading } = useEligibleExpensesForImmobilisation()

  const { register, control, handleSubmit, formState: { errors } } = useForm<ImmobilisationInput>({
    resolver: zodResolver(immobilisationSchema) as Resolver<ImmobilisationInput>,
    defaultValues: { residualValue: 0 },
    mode: "onSubmit",
  })

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const expenseOptions = (eligibleExpenses as EligibleExpense[]).map(e => ({
    value: e.id,
    label: `${e.vendor || e.description || e.id} — ${fmt(e.amount)} (${new Date(e.date).toLocaleDateString("fr-FR", { timeZone: "UTC" })})`,
  }))

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField
        label={t("finances.immobilisationForm.label")}
        required
        placeholder={t("finances.immobilisationForm.labelPlaceholder")}
        error={errors.label?.message}
        {...register("label")}
      />

      <Controller
        name="expenseId"
        control={control}
        render={({ field }) => (
          <SelectField
            label={t("finances.immobilisationForm.expense")}
            placeholder={expensesLoading ? "…" : t("finances.immobilisationForm.expensePlaceholder")}
            options={expenseOptions}
            value={field.value ?? ""}
            onValueChange={field.onChange}
            error={errors.expenseId?.message ?? (!expensesLoading && expenseOptions.length === 0 ? t("finances.immobilisationForm.noEligibleExpenses") : undefined)}
          />
        )}
      />

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="acquisitionDate"
          control={control}
          render={({ field }) => (
            <DateField label={t("finances.immobilisationForm.acquisitionDate")} required value={field.value ?? ""} onChange={field.onChange} error={errors.acquisitionDate?.message} />
          )}
        />
        <Controller
          name="usageStartDate"
          control={control}
          render={({ field }) => (
            <DateField label={t("finances.immobilisationForm.usageStartDate")} required value={field.value ?? ""} onChange={field.onChange} error={errors.usageStartDate?.message} />
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("finances.immobilisationForm.usefulLifeMonths")}
          type="number"
          min={1}
          required
          error={errors.usefulLifeMonths?.message}
          {...register("usefulLifeMonths", { valueAsNumber: true })}
        />
        <Controller
          name="residualValue"
          control={control}
          render={({ field }) => (
            <CurrencyField label={t("finances.immobilisationForm.residualValue")} value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.residualValue?.message} />
          )}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading} disabled={expenseOptions.length === 0}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
