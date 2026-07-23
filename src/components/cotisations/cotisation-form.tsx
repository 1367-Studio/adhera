"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { cotisationSchema, type CotisationInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"

const statusOptions = [
  { value: "EN_ATTENTE", label: "En attente" },
  { value: "PAYE",       label: "Payée"      },
  { value: "EXONERE",    label: "Exonérée"   },
]

type MembreOption = { id: string; firstName: string; lastName: string }

interface CotisationFormProps {
  membres:       MembreOption[]
  defaultValues?: Partial<CotisationInput>
  onSubmit:      (data: CotisationInput) => Promise<void>
  onCancel:      () => void
  loading?:      boolean
  editMode?:     boolean
}

export function CotisationForm({ membres, defaultValues, onSubmit, onCancel, loading, editMode }: CotisationFormProps) {
  const { register, control, handleSubmit, reset, setValue, formState: { errors } } = useForm<CotisationInput>({
    resolver: zodResolver(cotisationSchema),
    defaultValues: { status: "EN_ATTENTE", year: new Date().getFullYear(), ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => { reset({ status: "EN_ATTENTE", year: new Date().getFullYear(), ...defaultValues }) }, [defaultValues, reset])

  const membreOptions = membres.map(m => ({
    value: m.id,
    label: `${m.lastName} ${m.firstName}`,
  }))

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {!editMode && (
        <Controller
          name="membreId"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Membre"
              required
              options={membreOptions}
              value={field.value}
              onValueChange={field.onChange}
              error={errors.membreId?.message}
              placeholder="Sélectionner un membre…"
            />
          )}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Année"
          type="number"
          required
          error={errors.year?.message}
          {...register("year", { valueAsNumber: true })}
        />
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField
              label="Montant"
              required
              value={field.value ?? 0}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.amount?.message}
            />
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Statut"
              required
              options={statusOptions}
              value={field.value}
              onValueChange={(v) => {
                field.onChange(v)
                if (v !== "PAYE") setValue("paidAt", "")
              }}
              error={errors.status?.message}
            />
          )}
        />
        <FormField
          label="Date de paiement"
          type="date"
          max={new Date().toISOString().split("T")[0]}
          error={errors.paidAt?.message}
          {...register("paidAt")}
        />
      </div>

      <TextareaField
        label="Note"
        placeholder="Informations supplémentaires…"
        rows={2}
        error={errors.note?.message}
        {...register("note")}
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
