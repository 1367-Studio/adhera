"use client"

import { useState, useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { evenementSchema, type EvenementInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { LocationPicker } from "@/components/ui/location-picker"
import { CurrencyField } from "@/components/ui/currency-field"
import { ImageUpload } from "@/components/ui/image-upload"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

function defaultDate() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(14, 0, 0, 0)
  // Build the datetime-local string from local getters — going through toISOString()
  // would convert through UTC and shift the displayed hour by the browser's UTC offset.
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface EvenementFormProps {
  defaultValues?: Partial<EvenementInput>
  onSubmit: (data: EvenementInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
  // Whether this event already has EvenementTicketType rows (managed separately, via the
  // "Tarifs" row action) — when true, the single price field below is ignored everywhere,
  // so its hint says so instead of the usual "leave at 0 for a free event".
  hasTicketTypes?: boolean
}

export function EvenementForm({ defaultValues, onSubmit, onCancel, loading, hasTicketTypes }: EvenementFormProps) {
  const t = useTranslations("evenements.form")
  const tCommon = useTranslations("common")
  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<EvenementInput>({
    resolver: zodResolver(evenementSchema),
    defaultValues: { date: defaultDate(), ...defaultValues },
    mode: "onSubmit",
  })

  const lat           = watch("lat")
  const lng           = watch("lng")
  const locationValue = watch("location") ?? ""
  const capacityValue = watch("capacity")

  // Same lazy-upload pattern as actualite-form.tsx: picking a file only creates a local
  // blob: preview, the real /api/upload only happens on submit — so cancelling out of
  // this form never leaves an orphaned file in R2.
  const [pendingFile, setPendingFile] = useState<{ blobUrl: string; file: File } | null>(null)
  const [uploading,   setUploading]   = useState(false)

  useEffect(() => {
    if (!pendingFile) return
    return () => URL.revokeObjectURL(pendingFile.blobUrl)
  }, [pendingFile])

  async function handleFormSubmit(data: EvenementInput) {
    if (!pendingFile) {
      await onSubmit(data)
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", pendingFile.file)
      fd.append("prefix", "adhera/evenements")
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      if (!res.ok) { toast.error(t("toasts.uploadError")); return }
      const { url } = (await res.json()) as { url: string }
      await onSubmit({ ...data, imageUrl: url })
      setPendingFile(null)
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
      <Controller
        name="imageUrl"
        control={control}
        render={({ field }) => (
          <div className="space-y-1.5">
            <Label>{t("coverImage")}</Label>
            <ImageUpload
              value={field.value ?? ""}
              onChange={url => { if (url === "") setPendingFile(null); field.onChange(url) }}
              prefix="adhera/evenements"
              aspectRatio="video"
              lazy
              onFilePending={(blobUrl, file) => setPendingFile({ blobUrl, file })}
            />
          </div>
        )}
      />

      <FormField
        label={t("title")}
        required
        placeholder={t("titlePlaceholder")}
        error={errors.title?.message}
        {...register("title")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={t("startDate")}
          type="datetime-local"
          required
          error={errors.date?.message}
          {...register("date")}
        />
        <FormField
          label={t("endDate")}
          type="datetime-local"
          error={errors.endDate?.message}
          {...register("endDate")}
        />
      </div>

      <LocationPicker
        label={t("location")}
        address={locationValue}
        lat={lat}
        lng={lng}
        onChange={({ address, lat: newLat, lng: newLng }) => {
          setValue("location", address)
          setValue("lat", newLat)
          setValue("lng", newLng)
        }}
        error={errors.location?.message}
      />

      {/* Price + Capacity */}
      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="price"
          control={control}
          render={({ field }) => (
            <CurrencyField
              label={t("price")}
              hint={hasTicketTypes ? t("priceOverriddenHint") : t("priceHint")}
              value={field.value ?? 0}
              onChange={v => field.onChange(v === 0 ? undefined : v)}
              onBlur={field.onBlur}
              error={errors.price?.message}
            />
          )}
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground">
            {t("capacity")} <span className="text-muted-foreground font-normal">{t("capacityHint")}</span>
          </label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="—"
            {...register("capacity", { setValueAs: v => v === "" || v == null ? undefined : Number(v) })}
            className={cn(
              "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring",
              errors.capacity && "border-destructive focus:ring-destructive",
            )}
          />
          {capacityValue != null && capacityValue > 0 && (
            <p className="text-xs text-muted-foreground">{t("capacityUnit", { count: capacityValue })}</p>
          )}
          {errors.capacity && <p className="text-xs text-destructive">{errors.capacity.message}</p>}
        </div>
      </div>

      <FormField
        label={t("adminNotificationEmail")}
        type="email"
        placeholder={t("adminNotificationEmailPlaceholder")}
        hint={t("adminNotificationEmailHint")}
        error={errors.adminNotificationEmail?.message}
        {...register("adminNotificationEmail")}
      />

      <Controller
        name="description"
        control={control}
        render={({ field }) => (
          <RichTextEditor
            label={t("description")}
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder={t("descriptionPlaceholder")}
            minHeight="120px"
            error={errors.description?.message}
          />
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading || uploading}>
          {tCommon("cancel")}
        </Button>
        <Button type="submit" loading={loading || uploading}>
          {tCommon("save")}
        </Button>
      </div>
    </form>
  )
}
