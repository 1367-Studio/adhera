"use client"

import { useEffect, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { useCreateMaterial, useUpdateMaterial, type Material, type MaterialInput, type MaterialStatus } from "@/hooks/use-materiel"
import { useFinanceCategories } from "@/hooks/use-finance-categories"
import { ImageUpload } from "@/components/ui/image-upload"
import { Label } from "@/components/ui/label"

function buildSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    name:          z.string().min(1, t("materiel.form.validation.required")).max(150),
    category:      z.string().max(80).optional(),
    categoryId:    z.string().optional(),
    imageUrl:      z.string().optional(),
    description:   z.string().max(1000).optional(),
    serialNumber:  z.string().max(100).optional(),
    quantity:      z.number().int().min(1, t("materiel.form.validation.minQuantity")),
    status:        z.enum(["DISPONIBLE", "EN_USE", "EN_MAINTENANCE", "HORS_SERVICE", "PERDU"]),
    location:      z.string().max(150).optional(),
    purchaseDate:  z.string().optional(),
    purchasePrice: z.number().optional(),
    rentalRate:    z.number().optional(),
    notes:         z.string().max(1000).optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>

export const MATERIAL_CATEGORIES = [
  "Audiovisuel",
  "Bureau / Fournitures",
  "Communication / Impression",
  "Cuisine / Restauration",
  "Décoration / Scénographie",
  "Éclairage",
  "Électronique",
  "Événementiel",
  "Informatique",
  "Jeux / Loisirs",
  "Livres / Documentation",
  "Mobilier",
  "Musique / Instruments",
  "Outillage",
  "Sécurité / Premiers secours",
  "Sonorisation",
  "Sport",
  "Textile / Costumes",
  "Véhicule",
  "Autre",
] as const

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  material?:    Material | null
}

export function MaterialModal({ open, onOpenChange, material }: Props) {
  const t = useTranslations()

  const statusOptions = [
    { value: "DISPONIBLE",     label: t("materiel.form.status.disponible")    },
    { value: "EN_USE",         label: t("materiel.form.status.enUse")         },
    { value: "EN_MAINTENANCE", label: t("materiel.form.status.enMaintenance") },
    { value: "HORS_SERVICE",   label: t("materiel.form.status.horsService")  },
    { value: "PERDU",          label: t("materiel.form.status.perdu")         },
  ]

  const categoryOptions = [
    { value: "", label: t("materiel.form.noneOption") },
    ...MATERIAL_CATEGORIES.map(c => ({ value: c, label: c })),
  ]

  const isEditing = !!material
  const createMut = useCreateMaterial()
  const updateMut = useUpdateMaterial(material?.id ?? "")
  const { data: financeCategories = [] } = useFinanceCategories("INCOME")
  const financeCategoryOptions = [
    { value: "", label: t("materiel.form.noneOption") },
    ...financeCategories.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name })),
  ]

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver:      zodResolver(buildSchema(t)),
    defaultValues: { name: "", quantity: 1, status: "DISPONIBLE" },
  })

  // Same lazy-upload pattern as branding-settings.tsx / the site builder: picking a file
  // only creates a local blob: preview, the real /api/upload only happens on submit — so
  // clicking "Annuler" (or just closing the modal) never leaves an orphaned file in R2.
  const [pendingFile, setPendingFile] = useState<{ blobUrl: string; file: File } | null>(null)

  useEffect(() => {
    if (!pendingFile) return
    return () => URL.revokeObjectURL(pendingFile.blobUrl)
  }, [pendingFile])

  useEffect(() => {
    if (!open) return
    setPendingFile(null)
    reset(material ? {
      name:          material.name,
      category:      material.category ?? "",
      categoryId:    material.categoryId ?? "",
      imageUrl:      material.imageUrl ?? "",
      description:   material.description ?? "",
      serialNumber:  material.serialNumber ?? "",
      quantity:      material.quantity,
      status:        material.status,
      location:      material.location ?? "",
      purchaseDate:  material.purchaseDate ? material.purchaseDate.slice(0, 10) : "",
      purchasePrice: material.purchasePrice ? Number(material.purchasePrice) : 0,
      rentalRate:    material.rentalRate ? Number(material.rentalRate) : 0,
      notes:         material.notes ?? "",
    } : { name: "", quantity: 1, status: "DISPONIBLE", category: "", categoryId: "", imageUrl: "", description: "", serialNumber: "", location: "", purchaseDate: "", purchasePrice: 0, rentalRate: 0, notes: "" })
  }, [open, material, reset])

  async function onSubmit(values: FormValues) {
    let imageUrl = values.imageUrl || null
    if (pendingFile) {
      const fd = new FormData()
      fd.append("file", pendingFile.file)
      fd.append("prefix", "materiel")
      const uploadRes = await fetch("/api/upload", { method: "POST", body: fd })
      if (!uploadRes.ok) { toast.error(t("materiel.form.toasts.uploadError")); return }
      imageUrl = ((await uploadRes.json()) as { url: string }).url
    }

    const payload: MaterialInput = {
      name:          values.name,
      category:      values.category || null,
      categoryId:    values.categoryId || null,
      imageUrl,
      description:   values.description || null,
      serialNumber:  values.serialNumber || null,
      quantity:      values.quantity,
      status:        values.status as MaterialStatus,
      location:      values.location || null,
      purchaseDate:  values.purchaseDate || null,
      purchasePrice: values.purchasePrice || null,
      rentalRate:    values.rentalRate || null,
      notes:         values.notes || null,
    }
    try {
      if (isEditing) {
        await updateMut.mutateAsync(payload)
        toast.success(t("materiel.form.toasts.updated"))
      } else {
        await createMut.mutateAsync(payload)
        toast.success(t("materiel.form.toasts.created"))
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const isPending = isSubmitting || createMut.isPending || updateMut.isPending

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={isEditing ? t("materiel.form.editTitle") : t("materiel.form.newTitle")} size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Controller
          name="imageUrl"
          control={control}
          render={({ field }) => (
            <div className="space-y-1.5">
              <Label>{t("materiel.form.photo")}</Label>
              <ImageUpload
                value={field.value ?? ""}
                onChange={url => { if (url === "") setPendingFile(null); field.onChange(url) }}
                prefix="materiel"
                aspectRatio="video"
                className="w-full"
                lazy
                onFilePending={(blobUrl, file) => setPendingFile({ blobUrl, file })}
              />
            </div>
          )}
        />

        <FormField label={t("materiel.form.name")} required placeholder={t("materiel.form.namePlaceholder")} error={errors.name?.message} {...register("name")} />

        <div className="grid grid-cols-2 gap-3">
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <SelectField
                label={t("materiel.form.category")}
                options={categoryOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                placeholder={t("materiel.form.noneOption")}
              />
            )}
          />

          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <SelectField label={t("membres.form.fields.status")} options={statusOptions} value={field.value} onValueChange={field.onChange} />
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("materiel.form.quantity")} type="number" min={1} error={errors.quantity?.message} {...register("quantity", { valueAsNumber: true })} />
          <FormField label={t("materiel.form.location")} placeholder={t("materiel.form.locationPlaceholder")} {...register("location")} />
        </div>

        <FormField label={t("materiel.form.serialNumber")} placeholder={t("materiel.form.serialNumberPlaceholder")} {...register("serialNumber")} />

        <FormField label={t("materiel.form.description")} placeholder={t("materiel.form.descriptionPlaceholder")} {...register("description")} />

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("materiel.form.purchaseDate")} type="date" {...register("purchaseDate")} />
          <Controller
            name="purchasePrice"
            control={control}
            render={({ field }) => (
              <CurrencyField label={t("materiel.form.purchasePrice")} value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.purchasePrice?.message} />
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Controller
            name="rentalRate"
            control={control}
            render={({ field }) => (
              <CurrencyField
                label={t("materiel.form.rentalRate")}
                hint={t("materiel.form.rentalRateHint")}
                value={field.value ?? 0}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errors.rentalRate?.message}
              />
            )}
          />
          <Controller
            name="categoryId"
            control={control}
            render={({ field }) => (
              <SelectField
                label={t("materiel.form.accountingCategory")}
                options={financeCategoryOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                placeholder={t("materiel.form.noneOption")}
              />
            )}
          />
        </div>

        <FormField label={t("materiel.form.notes")} placeholder={t("materiel.form.notesPlaceholder")} {...register("notes")} />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>{t("common.cancel")}</Button>
          <Button type="submit" loading={isPending}>{isEditing ? t("common.save") : t("materiel.form.create")}</Button>
        </div>
      </form>
    </Modal>
  )
}
