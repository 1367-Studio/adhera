"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { grupoSchema, type GrupoInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { Button } from "@/components/ui/button"

interface GrupoFormProps {
  defaultValues?: Partial<GrupoInput>
  onSubmit: (data: GrupoInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function GrupoForm({ defaultValues, onSubmit, onCancel, loading }: GrupoFormProps) {
  const t = useTranslations("groupes.form")
  const tc = useTranslations("common")

  const { register, handleSubmit, reset, formState: { errors } } = useForm<GrupoInput>({
    resolver: zodResolver(grupoSchema),
    defaultValues: { nome: "", descricao: "", ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => { reset({ nome: "", descricao: "", ...defaultValues }) }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField
        label={t("nomeLabel")}
        placeholder={t("nomePlaceholder")}
        required
        error={errors.nome?.message}
        {...register("nome")}
      />
      <TextareaField
        label={t("descricaoLabel")}
        placeholder={t("descricaoPlaceholder")}
        rows={3}
        error={errors.descricao?.message}
        {...register("descricao")}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{tc("cancel")}</Button>
        <Button type="submit" loading={loading}>{tc("save")}</Button>
      </div>
    </form>
  )
}
