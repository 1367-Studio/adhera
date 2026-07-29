"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { fournisseurSchema, type FournisseurInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { Button } from "@/components/ui/button"

interface FournisseurFormProps {
  defaultValues?: Partial<FournisseurInput>
  onSubmit: (data: FournisseurInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function FournisseurForm({ defaultValues, onSubmit, onCancel, loading }: FournisseurFormProps) {
  const t = useTranslations()

  // "ARCHIVE" is a valid FournisseurStatus in the DB but deliberately not offered here —
  // archiving is done via the dedicated "Archiver" action (soft delete, deletedAt), not by
  // hand-picking a status. Having both was confusing: a fournisseur with status=Archivé
  // still showed up in every list (just filterable), while "Archiver" hides it completely —
  // two different things sharing the same word. See [[project-devis-facture-fournisseur-modules]].
  const statusOptions = [
    { value: "ACTIF",   label: t("fournisseurs.form.status.actif")   },
    { value: "INACTIF", label: t("fournisseurs.form.status.inactif") },
  ]

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
          label={t("fournisseurs.form.companyName")}
          required
          error={errors.companyName?.message}
          {...register("companyName")}
        />
        <FormField
          label={t("fournisseurs.form.tradeName")}
          error={errors.tradeName?.message}
          {...register("tradeName")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("fournisseurs.form.contact")}
          placeholder={t("fournisseurs.form.contactPlaceholder")}
          error={errors.contactName?.message}
          {...register("contactName")}
        />
        <FormField
          label={t("fournisseurs.form.contactRole")}
          error={errors.contactRole?.message}
          {...register("contactRole")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("fournisseurs.form.email")}
          type="email"
          placeholder={t("fournisseurs.form.emailPlaceholder")}
          error={errors.email?.message}
          {...register("email")}
        />
        <FormField
          label={t("fournisseurs.form.phone")}
          type="tel"
          placeholder={t("fournisseurs.form.phonePlaceholder")}
          error={errors.phone?.message}
          {...register("phone")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("fournisseurs.form.billingEmail")}
          type="email"
          error={errors.billingEmail?.message}
          {...register("billingEmail")}
        />
        <FormField
          label={t("fournisseurs.form.website")}
          placeholder="https://..."
          error={errors.website?.message}
          {...register("website")}
        />
      </div>

      <FormField
        label={t("fournisseurs.form.address")}
        placeholder={t("fournisseurs.form.addressPlaceholder")}
        error={errors.address?.message}
        {...register("address")}
      />

      <div className="grid grid-cols-3 gap-4">
        <FormField
          label={t("fournisseurs.form.city")}
          error={errors.city?.message}
          {...register("city")}
        />
        <FormField
          label={t("fournisseurs.form.postalCode")}
          error={errors.postalCode?.message}
          {...register("postalCode")}
        />
        <FormField
          label={t("fournisseurs.form.country")}
          error={errors.country?.message}
          {...register("country")}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField
          label={t("fournisseurs.form.siret")}
          error={errors.siret?.message}
          {...register("siret")}
        />
        <FormField
          label={t("fournisseurs.form.siren")}
          error={errors.siren?.message}
          {...register("siren")}
        />
        <FormField
          label={t("fournisseurs.form.vatNumber")}
          error={errors.vatNumber?.message}
          {...register("vatNumber")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("fournisseurs.form.category")}
          placeholder={t("fournisseurs.form.categoryPlaceholder")}
          error={errors.category?.message}
          {...register("category")}
        />
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("membres.form.fields.status")}
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
        label={t("fournisseurs.form.notes")}
        rows={3}
        error={errors.notes?.message}
        {...register("notes")}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={loading}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  )
}
