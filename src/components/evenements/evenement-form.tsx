"use client"

import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { evenementSchema, type EvenementInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { LocationPicker } from "@/components/ui/location-picker"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function defaultDate() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(14, 0, 0, 0)
  return d.toISOString().slice(0, 16)
}

interface EvenementFormProps {
  defaultValues?: Partial<EvenementInput>
  onSubmit: (data: EvenementInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function EvenementForm({ defaultValues, onSubmit, onCancel, loading }: EvenementFormProps) {
  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<EvenementInput>({
    resolver: zodResolver(evenementSchema),
    defaultValues: { date: defaultDate(), ...defaultValues },
    mode: "onSubmit",
  })

  const lat           = watch("lat")
  const lng           = watch("lng")
  const locationValue = watch("location") ?? ""
  const capacityValue = watch("capacity")

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField
        label="Titre"
        required
        placeholder="Assemblée générale 2025"
        error={errors.title?.message}
        {...register("title")}
      />

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Date de début"
          type="datetime-local"
          required
          error={errors.date?.message}
          {...register("date")}
        />
        <FormField
          label="Date de fin"
          type="datetime-local"
          error={errors.endDate?.message}
          {...register("endDate")}
        />
      </div>

      <LocationPicker
        label="Lieu"
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
              label="Tarif"
              hint="Laisser à 0 pour un événement gratuit"
              value={field.value ?? 0}
              onChange={v => field.onChange(v === 0 ? undefined : v)}
              onBlur={field.onBlur}
              error={errors.price?.message}
            />
          )}
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground">
            Capacité <span className="text-muted-foreground font-normal">(vide = illimitée)</span>
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
            <p className="text-xs text-muted-foreground">{capacityValue} place{capacityValue > 1 ? "s" : ""}</p>
          )}
          {errors.capacity && <p className="text-xs text-destructive">{errors.capacity.message}</p>}
        </div>
      </div>

      <Controller
        name="description"
        control={control}
        render={({ field }) => (
          <RichTextEditor
            label="Description"
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder="Détails de l'événement…"
            minHeight="120px"
            error={errors.description?.message}
          />
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Annuler
        </Button>
        <Button type="submit" loading={loading}>
          Enregistrer
        </Button>
      </div>
    </form>
  )
}
