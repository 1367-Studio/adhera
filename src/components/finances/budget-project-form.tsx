"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { budgetProjectSchema, type BudgetProjectInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { Button } from "@/components/ui/button"

interface BudgetProjectFormProps {
  defaultValues?: Partial<BudgetProjectInput>
  onSubmit: (data: BudgetProjectInput) => Promise<void>
  onCancel: () => void
  loading?:  boolean
}

// Used both to create a project and, from its row menu, to edit its name/description — the
// spec explicitly wants renaming to live in project management, not next to the title in the
// budget summary (see previsionnel-project-tab.tsx).
export function BudgetProjectForm({ defaultValues, onSubmit, onCancel, loading }: BudgetProjectFormProps) {
  const t = useTranslations("finances.previsionnel.projectsTab")
  const tCommon = useTranslations("common")

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BudgetProjectInput>({
    resolver: zodResolver(budgetProjectSchema),
    defaultValues: { name: "", description: "", ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ name: "", description: "", ...defaultValues })
  }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField label={t("name")} required placeholder={t("namePlaceholder")} error={errors.name?.message} {...register("name")} />
      <TextareaField label={t("description")} placeholder={t("descriptionPlaceholder")} error={errors.description?.message} rows={3} {...register("description")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{tCommon("cancel")}</Button>
        <Button type="submit" loading={loading}>{tCommon("save")}</Button>
      </div>
    </form>
  )
}
