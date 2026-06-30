"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { financeCategorySchema, type FinanceCategoryInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"

const typeOptions = [
  { value: "INCOME",  label: "Recette" },
  { value: "EXPENSE", label: "Dépense" },
]

interface FinanceCategoryFormProps {
  defaultValues?: Partial<FinanceCategoryInput>
  onSubmit:  (data: FinanceCategoryInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
}

export function FinanceCategoryForm({ defaultValues, onSubmit, onCancel, loading }: FinanceCategoryFormProps) {
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
      <FormField label="Nom" required placeholder="Ex: Cotisations" error={errors.name?.message} {...register("name")} />

      <Controller
        name="type"
        control={control}
        render={({ field }) => (
          <SelectField label="Type" required options={typeOptions} value={field.value} onValueChange={field.onChange} error={errors.type?.message} />
        )}
      />

      <FormField label="Code comptable" placeholder="Ex: 70600" error={errors.accountingCode?.message} {...register("accountingCode")} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Annuler</Button>
        <Button type="submit" loading={loading}>Enregistrer</Button>
      </div>
    </form>
  )
}
