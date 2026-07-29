"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { financeCategorySchema, type FinanceCategoryInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"

interface FinanceCategoryFormProps {
  defaultValues?: Partial<FinanceCategoryInput>
  onSubmit:  (data: FinanceCategoryInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
}

export function FinanceCategoryForm({ defaultValues, onSubmit, onCancel, loading }: FinanceCategoryFormProps) {
  const t = useTranslations()

  const typeOptions = [
    { value: "INCOME",  label: t("finances.categoryForm.typeIncome")  },
    { value: "EXPENSE", label: t("finances.categoryForm.typeExpense") },
  ]

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<FinanceCategoryInput>({
    resolver: zodResolver(financeCategorySchema),
    defaultValues: { type: "INCOME", ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ type: "INCOME", ...defaultValues })
  }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField label={t("finances.categoryForm.name")} required placeholder={t("finances.categoryForm.namePlaceholder")} error={errors.name?.message} {...register("name")} />

      <Controller
        name="type"
        control={control}
        render={({ field }) => (
          <SelectField label={t("finances.categoryForm.type")} required options={typeOptions} value={field.value} onValueChange={field.onChange} error={errors.type?.message} />
        )}
      />

      <FormField label={t("finances.categoryForm.accountingCode")} placeholder={t("finances.categoryForm.accountingCodePlaceholder")} error={errors.accountingCode?.message} {...register("accountingCode")} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
