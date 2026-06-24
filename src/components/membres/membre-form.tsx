"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { membreSchema, type MembreInput } from "@/lib/schemas"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { MembreTypeBadge } from "@/components/ui/membre-type-badge"
import { Button } from "@/components/ui/button"

const statusOptions = [
  { value: "PENDING",  label: "En attente" },
  { value: "ACTIF",    label: "Actif"      },
  { value: "INACTIF",  label: "Inactif"    },
  { value: "SUSPENDU", label: "Suspendu"   },
]

interface MembreFormProps {
  defaultValues?: Partial<MembreInput>
  onSubmit: (data: MembreInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function MembreForm({ defaultValues, onSubmit, onCancel, loading }: MembreFormProps) {
  const { data: types = [] } = useMembreTypes()

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<MembreInput>({
    resolver: zodResolver(membreSchema),
    defaultValues: { status: "ACTIF", ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => { reset({ status: "ACTIF", ...defaultValues }) }, [defaultValues, reset])

  const typeOptions = [
    { value: "", label: "Aucun type" },
    ...types.map(t => ({ value: t.id, label: t.name })),
  ]

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Prénom"
          required
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <FormField
          label="Nom"
          required
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Email"
          type="email"
          placeholder="contact@example.com"
          error={errors.email?.message}
          {...register("email")}
        />
        <FormField
          label="Téléphone"
          type="tel"
          placeholder="+33 6 12 34 56 78"
          error={errors.phone?.message}
          {...register("phone")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Date de naissance"
          type="date"
          max={new Date().toISOString().split("T")[0]}
          error={errors.birthDate?.message}
          {...register("birthDate")}
        />
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Statut"
              required
              options={statusOptions}
              value={field.value}
              onValueChange={field.onChange}
              error={errors.status?.message}
            />
          )}
        />
      </div>

      {/* Type de membre */}
      {types.length > 0 && (
        <Controller
          name="typeId"
          control={control}
          render={({ field }) => (
            <div className="space-y-1.5">
              <SelectField
                label="Type de membre"
                options={typeOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={errors.typeId?.message}
              />
              {field.value && (() => {
                const t = types.find(t => t.id === field.value)
                return t ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Aperçu :</span>
                    <MembreTypeBadge name={t.name} color={t.color} />
                  </div>
                ) : null
              })()}
            </div>
          )}
        />
      )}

      <FormField
        label="Adresse"
        placeholder="12 rue de la Paix, 75001 Paris"
        error={errors.address?.message}
        {...register("address")}
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
