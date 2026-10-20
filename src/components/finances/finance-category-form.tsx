"use client"

import { useEffect } from "react"
import { useForm, useWatch, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { financeCategorySchema, type FinanceCategoryInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"

interface FinanceCategoryFormProps {
  defaultValues?: Partial<FinanceCategoryInput>
  // Accounting codes already used by this association's other categories (the one being
  // edited, if any, is excluded by the caller) — surfaced as a non-blocking warning only,
  // never a hard validation error: associations are free to reuse a code deliberately.
  takenAccountingCodes?: string[]
  onSubmit:  (data: FinanceCategoryInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
}

export function FinanceCategoryForm({ defaultValues, takenAccountingCodes = [], onSubmit, onCancel, loading }: FinanceCategoryFormProps) {
  const t = useTranslations()

  const typeOptions = [
    { value: "INCOME",  label: t("finances.categoryForm.typeIncome")  },
    { value: "EXPENSE", label: t("finances.categoryForm.typeExpense") },
  ]

  const sectionOptions = [
    { value: "OPERATING",   label: t("finances.categoryForm.sectionOptions.OPERATING")   },
    { value: "FINANCIAL",   label: t("finances.categoryForm.sectionOptions.FINANCIAL")   },
    { value: "EXCEPTIONAL", label: t("finances.categoryForm.sectionOptions.EXCEPTIONAL") },
    { value: "OTHER",       label: t("finances.categoryForm.sectionOptions.OTHER")       },
    { value: "IN_KIND",     label: t("finances.categoryForm.sectionOptions.IN_KIND")     },
  ]

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<FinanceCategoryInput>({
    resolver: zodResolver(financeCategorySchema) as Resolver<FinanceCategoryInput>,
    defaultValues: { type: "INCOME", section: "OPERATING", ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ type: "INCOME", section: "OPERATING", ...defaultValues })
  }, [defaultValues, reset])

  const accountingCode = useWatch({ control, name: "accountingCode" })
  const isDuplicateAccountingCode = Boolean(accountingCode && takenAccountingCodes.includes(accountingCode.trim()))

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
      {isDuplicateAccountingCode && (
        <p className="-mt-3 text-xs text-muted-foreground">{t("finances.categoryForm.accountingCodeDuplicateWarning")}</p>
      )}

      <Controller
        name="section"
        control={control}
        render={({ field }) => (
          <SelectField label={t("finances.categoryForm.section")} options={sectionOptions} value={field.value} onValueChange={field.onChange} error={errors.section?.message} />
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
