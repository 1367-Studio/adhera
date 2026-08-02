"use client"

import { useEffect } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { exerciceComptableSchema } from "@/lib/schemas"
import type { ExerciceInput } from "@/hooks/use-exercices"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"

interface ExerciceFormProps {
  isFounding:     boolean
  patternHint?:   string
  defaultValues?: Partial<ExerciceInput>
  onSubmit:       (data: ExerciceInput) => Promise<void>
  onCancel:       () => void
  loading?:       boolean
}

export function ExerciceForm({ isFounding, patternHint, defaultValues, onSubmit, onCancel, loading }: ExerciceFormProps) {
  const t = useTranslations()

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ExerciceInput>({
    resolver: zodResolver(exerciceComptableSchema) as Resolver<ExerciceInput>,
    defaultValues,
    mode: "onSubmit",
  })

  // Re-syncs the form when the parent auto-fills the corrected dates after a
  // PATTERN_MISMATCH response — without this, the fields would keep showing what the
  // user originally typed instead of the server-provided correction.
  useEffect(() => {
    reset(defaultValues)
  }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {isFounding && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t("finances.exerciceForm.foundingWarning")}
        </div>
      )}

      {!isFounding && patternHint && (
        <div className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
          {t("finances.exerciceForm.patternHint", { pattern: patternHint })}
        </div>
      )}

      <FormField label={t("finances.exerciceForm.label")} required placeholder={t("finances.exerciceForm.labelPlaceholder")} error={errors.label?.message} {...register("label")} />

      <div className="grid grid-cols-2 gap-4">
        <FormField label={t("finances.exerciceForm.startDate")} type="date" required error={errors.startDate?.message} {...register("startDate")} />
        <FormField label={t("finances.exerciceForm.endDate")}   type="date" required error={errors.endDate?.message}   {...register("endDate")} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
