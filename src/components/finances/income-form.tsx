"use client"

import { useEffect } from "react"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { incomeSchema, type IncomeInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { useFinanceCategories } from "@/hooks/use-finance-categories"

const statusOptions = [
  { value: "PENDING",   label: "En attente" },
  { value: "PAID",      label: "Payé" },
  { value: "CANCELLED", label: "Annulé" },
]

const paymentMethodOptions = [
  { value: "",         label: "Non renseigné" },
  { value: "VIREMENT", label: "Virement" },
  { value: "CHEQUE",   label: "Chèque" },
  { value: "ESPECES",  label: "Espèces" },
  { value: "STRIPE",   label: "Stripe" },
  { value: "AUTRE",    label: "Autre" },
]

interface IncomeFormProps {
  defaultValues?: Partial<IncomeInput>
  onSubmit:  (data: IncomeInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
  // True when this row was auto-created from a Facture payment — amount/date/status/
  // reference must stay in sync with that payment, so they're locked here; category and
  // description are still association-side annotations and stay editable.
  locked?: boolean
}

export function IncomeForm({ defaultValues, onSubmit, onCancel, loading, locked }: IncomeFormProps) {
  const { data: categories = [] } = useFinanceCategories("INCOME")
  const categoryOptions = [
    { value: "", label: "Aucune catégorie" },
    ...categories.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name })),
  ]

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<IncomeInput>({
    resolver: zodResolver(incomeSchema) as Resolver<IncomeInput>,
    defaultValues: {
      date:   new Date().toISOString().split("T")[0],
      status: "PENDING",
      source: "MANUAL",
      ...defaultValues,
    },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ date: new Date().toISOString().split("T")[0], status: "PENDING", source: "MANUAL", ...defaultValues })
  }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {locked && (
        <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
          Montant, date, statut et référence viennent du paiement de la facture d&apos;origine — modifiez-les depuis Factures. Catégorie et description restent modifiables ici.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField label="Montant" required disabled={locked} value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.amount?.message} />
          )}
        />
        <FormField label="Date" type="date" required disabled={locked} error={errors.date?.message} {...register("date")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="categoryId"
          control={control}
          render={({ field }) => (
            <SelectField label="Catégorie" options={categoryOptions} value={field.value ?? ""} onValueChange={field.onChange} error={errors.categoryId?.message} />
          )}
        />
        <Controller
          name="paymentMethod"
          control={control}
          render={({ field }) => (
            <SelectField label="Mode de paiement" options={paymentMethodOptions} value={field.value ?? ""} onValueChange={field.onChange} />
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <SelectField label="Statut" options={statusOptions} disabled={locked} value={field.value ?? "PENDING"} onValueChange={field.onChange} />
          )}
        />
        <FormField label="Référence" placeholder="Ex: VIR-2024-001" disabled={locked} error={errors.reference?.message} {...register("reference")} />
      </div>

      <FormField label="Description" placeholder="Ex: Cotisation annuelle 2024" error={errors.description?.message} {...register("description")} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Annuler</Button>
        <Button type="submit" loading={loading}>Enregistrer</Button>
      </div>
    </form>
  )
}
