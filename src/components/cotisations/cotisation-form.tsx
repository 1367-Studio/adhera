"use client"

import { useEffect } from "react"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { cotisationSchema, cotisationUpdateSchema, type CotisationInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"

type MembreOption = { id: string; firstName: string; lastName: string }

const paymentMethodOptions = [
  { value: "CB",       label: "CB"       },
  { value: "CHQ",      label: "CHQ"      },
  { value: "ESP",      label: "ESP"      },
  { value: "En ligne", label: "En ligne" },
]

interface CotisationFormProps {
  membres:       MembreOption[]
  defaultValues?: Partial<CotisationInput>
  onSubmit:      (data: CotisationInput) => Promise<void>
  onCancel:      () => void
  loading?:      boolean
  editMode?:     boolean
  /** Amount already paid on this cotisation (0 for a new one). Once positive, the status is
   *  driven by recorded payments (see "Enregistrer un paiement" / "Historique des paiements")
   *  rather than hand-picked here. */
  amountPaid?:   number
}

export function CotisationForm({ membres, defaultValues, onSubmit, onCancel, loading, editMode, amountPaid = 0 }: CotisationFormProps) {
  const t = useTranslations()

  // PARTIELLEMENT_PAYEE isn't a manual choice — it's derived from recorded payments (see
  // "Enregistrer un paiement"). It's only included here so the locked Select below still
  // shows its label when that's the cotisation's current status.
  const allStatusOptions = [
    { value: "EN_ATTENTE",          label: t("membres.detail.cotisationStatus.enAttente")          },
    { value: "PARTIELLEMENT_PAYEE", label: t("membres.detail.cotisationStatus.partiellementPayee") },
    { value: "PAYE",                label: t("membres.detail.cotisationStatus.paye")                },
    { value: "EXONERE",             label: t("membres.detail.cotisationStatus.exonere")             },
  ]

  // Once a payment exists, the status can no longer be hand-picked — removing/adding
  // payments (via the dedicated modal) is what should move it, not this dropdown.
  const statusLocked = amountPaid > 0
  const statusOptions = statusLocked
    ? allStatusOptions.filter(o => o.value === defaultValues?.status)
    : allStatusOptions.filter(o => o.value !== "PARTIELLEMENT_PAYEE")

  // Edit mode validates against the looser update schema — it doesn't require paidAt/
  // paymentMethod just because status happens to be PAYE, since editing an already-paid
  // cotisation (e.g. its note) resubmits that same status without a new payment being made.
  // The create schema keeps that requirement, since there status=PAYE always means a fresh
  // one-shot payment is being recorded right now. See src/lib/schemas/cotisation.ts.
  const { register, control, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<CotisationInput>({
    resolver: zodResolver(editMode ? cotisationUpdateSchema : cotisationSchema) as Resolver<CotisationInput>,
    defaultValues: { status: "EN_ATTENTE", year: new Date().getFullYear(), ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => { reset({ status: "EN_ATTENTE", year: new Date().getFullYear(), ...defaultValues }) }, [defaultValues, reset])

  const status = watch("status")

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
              label={t("cotisations.form.member")}
              required
              options={membreOptions}
              value={field.value}
              onValueChange={field.onChange}
              error={errors.membreId?.message}
              placeholder={t("cotisations.form.memberPlaceholder")}
            />
          )}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("cotisations.form.year")}
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
              label={t("cotisations.form.amount")}
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
              label={t("membres.form.fields.status")}
              required
              disabled={statusLocked}
              options={statusOptions}
              value={field.value}
              onValueChange={(v) => {
                field.onChange(v)
                if (v !== "PAYE") {
                  setValue("paidAt", "")
                  setValue("paymentMethod", "")
                }
              }}
              error={errors.status?.message}
            />
          )}
        />
        <FormField
          label={t("cotisations.form.dueDate")}
          type="date"
          error={errors.dueDate?.message}
          {...register("dueDate")}
        />
      </div>

      {statusLocked && (
        <p className="text-xs text-muted-foreground -mt-2">{t("cotisations.form.statusLockedHint")}</p>
      )}

      {status === "PAYE" && !statusLocked && (
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label={t("cotisations.form.paidAt")}
            type="date"
            max={new Date().toISOString().split("T")[0]}
            error={errors.paidAt?.message}
            {...register("paidAt")}
          />
          <Controller
            name="paymentMethod"
            control={control}
            render={({ field }) => (
              <SelectField
                label={t("cotisations.form.paymentMethod")}
                required
                options={paymentMethodOptions}
                value={field.value}
                onValueChange={field.onChange}
                error={errors.paymentMethod?.message}
              />
            )}
          />
        </div>
      )}

      <TextareaField
        label={t("cotisations.form.note")}
        placeholder={t("cotisations.form.notePlaceholder")}
        rows={2}
        error={errors.note?.message}
        {...register("note")}
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
