"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { fournisseurSchema, type FournisseurInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { Button } from "@/components/ui/button"

// "ARCHIVE" is a valid FournisseurStatus in the DB but deliberately not offered here —
// archiving is done via the dedicated "Archiver" action (soft delete, deletedAt), not by
// hand-picking a status. Having both was confusing: a fournisseur with status=Archivé
// still showed up in every list (just filterable), while "Archiver" hides it completely —
// two different things sharing the same word. See [[project-devis-facture-fournisseur-modules]].
const statusOptions = [
  { value: "ACTIF",   label: "Actif"   },
  { value: "INACTIF", label: "Inactif" },
]

interface FournisseurFormProps {
  defaultValues?: Partial<FournisseurInput>
  onSubmit: (data: FournisseurInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function FournisseurForm({ defaultValues, onSubmit, onCancel, loading }: FournisseurFormProps) {
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<FournisseurInput>({
    resolver: zodResolver(fournisseurSchema),
    defaultValues: { status: "ACTIF", country: "France", ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => { reset({ status: "ACTIF", country: "France", ...defaultValues }) }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Raison sociale"
          required
          error={errors.companyName?.message}
          {...register("companyName")}
        />
        <FormField
          label="Nom commercial"
          error={errors.tradeName?.message}
          {...register("tradeName")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Contact"
          placeholder="Nom du contact"
          error={errors.contactName?.message}
          {...register("contactName")}
        />
        <FormField
          label="Fonction du contact"
          error={errors.contactRole?.message}
          {...register("contactRole")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Email"
          type="email"
          placeholder="contact@fournisseur.fr"
          error={errors.email?.message}
          {...register("email")}
        />
        <FormField
          label="Téléphone"
          type="tel"
          placeholder="+33 1 23 45 67 89"
          error={errors.phone?.message}
          {...register("phone")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Email de facturation"
          type="email"
          error={errors.billingEmail?.message}
          {...register("billingEmail")}
        />
        <FormField
          label="Site web"
          placeholder="https://..."
          error={errors.website?.message}
          {...register("website")}
        />
      </div>

      <FormField
        label="Adresse"
        placeholder="12 rue de la Paix"
        error={errors.address?.message}
        {...register("address")}
      />

      <div className="grid grid-cols-3 gap-4">
        <FormField
          label="Ville"
          error={errors.city?.message}
          {...register("city")}
        />
        <FormField
          label="Code postal"
          error={errors.postalCode?.message}
          {...register("postalCode")}
        />
        <FormField
          label="Pays"
          error={errors.country?.message}
          {...register("country")}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField
          label="SIRET"
          error={errors.siret?.message}
          {...register("siret")}
        />
        <FormField
          label="SIREN"
          error={errors.siren?.message}
          {...register("siren")}
        />
        <FormField
          label="N° TVA"
          error={errors.vatNumber?.message}
          {...register("vatNumber")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Catégorie"
          placeholder="ex: Imprimerie, Traiteur…"
          error={errors.category?.message}
          {...register("category")}
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

      <TextareaField
        label="Notes internes"
        rows={3}
        error={errors.notes?.message}
        {...register("notes")}
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
