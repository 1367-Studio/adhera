"use client"

import { useEffect } from "react"
import { useForm, Controller, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { factureSchema, type FactureInput } from "@/lib/schemas"
import { useFournisseursList } from "@/hooks/use-fournisseurs"
import { buildFournisseurOptions } from "@/lib/fournisseur-options"
import { computeDocumentTotals } from "@/lib/devis-calc"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { CurrencyInput } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { useModules } from "@/lib/user-context"

// PAYEE and PARTIELLEMENT_PAYEE aren't manual choices — the backend derives them from
// amountPaid vs total (resolveManualStatus in facture-status.ts) the same way it derives
// EN_RETARD, so picking one by hand here would just get silently overridden on save. They're
// only ever offered once the facture already has a payment recorded (see `statusOptions`
// below), at which point the field is locked anyway and this list just needs to include the
// current value so the Select still shows its label.
const ALL_STATUS_OPTIONS = [
  { value: "BROUILLON",           label: "Brouillon"          },
  { value: "EN_ATTENTE",          label: "En attente"         },
  { value: "PARTIELLEMENT_PAYEE", label: "Partiellement payée" },
  { value: "PAYEE",               label: "Payée"               },
  { value: "ANNULEE",             label: "Annulée"             },
]

const emptyItem = { description: "", quantity: 1, unitPrice: 0, vatRate: 20, discount: 0 }

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

interface FactureFormProps {
  defaultValues?: Partial<FactureInput>
  onSubmit: (data: FactureInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
  /** Set when the facture originates from a converted devis — locks the fournisseur/devis link. */
  lockedFromDevis?: boolean
  /** Amount already paid on this facture (0 for a new one). Once positive, the status is
   *  driven by payments (see "Enregistrer un paiement" / "Historique des paiements") rather
   *  than hand-picked here — editing dates/items/notes stays free either way. */
  amountPaid?: number
}

export function FactureForm({ defaultValues, onSubmit, onCancel, loading, lockedFromDevis, amountPaid = 0 }: FactureFormProps) {
  const statusLocked = amountPaid > 0
  const statusOptions = statusLocked
    ? ALL_STATUS_OPTIONS
    : ALL_STATUS_OPTIONS.filter(o => o.value !== "PAYEE" && o.value !== "PARTIELLEMENT_PAYEE")

  const modules = useModules()
  const { data: fournisseurs = [] } = useFournisseursList(defaultValues?.fournisseurId || undefined, modules.fournisseurs)

  const { register, control, handleSubmit, reset, watch, formState: { errors } } = useForm<FactureInput>({
    resolver: zodResolver(factureSchema),
    defaultValues: {
      status:     "BROUILLON",
      issueDate:  new Date().toISOString().split("T")[0],
      items:      [emptyItem],
      ...defaultValues,
    },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({
      status:    "BROUILLON",
      issueDate: new Date().toISOString().split("T")[0],
      items:     [emptyItem],
      ...defaultValues,
    })
  }, [defaultValues, reset])

  const { fields, append, remove } = useFieldArray({ control, name: "items" })
  const items = watch("items")
  const totals = computeDocumentTotals(items ?? [])

  const fournisseurOptions = buildFournisseurOptions(fournisseurs)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        {modules.fournisseurs ? (
          <Controller
            name="fournisseurId"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Fournisseur"
                options={fournisseurOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={errors.fournisseurId?.message}
                disabled={lockedFromDevis}
              />
            )}
          />
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Fournisseur</p>
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Module Fournisseurs désactivé</p>
          </div>
        )}
        <div className="space-y-1.5">
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
                disabled={statusLocked}
              />
            )}
          />
          {statusLocked && (
            <p className="text-xs text-muted-foreground">Déterminé par les paiements enregistrés.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Date d'émission"
          type="date"
          required
          error={errors.issueDate?.message}
          {...register("issueDate")}
        />
        <FormField
          label="Date d'échéance"
          type="date"
          error={errors.dueDate?.message}
          {...register("dueDate")}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Articles</p>
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="rounded-lg border p-3 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <FormField
                    label="Description"
                    placeholder="Description"
                    error={errors.items?.[index]?.description?.message}
                    {...register(`items.${index}.description`)}
                    disabled={lockedFromDevis}
                  />
                </div>
                {!lockedFromDevis && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-6"
                    onClick={() => fields.length > 1 && remove(index)}
                    disabled={fields.length <= 1}
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <FormField
                  label="Qté"
                  type="number"
                  step="0.01"
                  min="0"
                  error={errors.items?.[index]?.quantity?.message}
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                  disabled={lockedFromDevis}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Prix unitaire</p>
                  <Controller
                    name={`items.${index}.unitPrice`}
                    control={control}
                    render={({ field }) => <CurrencyInput value={field.value} onChange={field.onChange} disabled={lockedFromDevis} />}
                  />
                </div>
                <FormField
                  label="TVA %"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  error={errors.items?.[index]?.vatRate?.message}
                  {...register(`items.${index}.vatRate`, { valueAsNumber: true })}
                  disabled={lockedFromDevis}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Remise</p>
                  <Controller
                    name={`items.${index}.discount`}
                    control={control}
                    render={({ field }) => <CurrencyInput value={field.value} onChange={field.onChange} disabled={lockedFromDevis} />}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        {errors.items?.message && <p className="text-xs text-destructive">{errors.items.message}</p>}
        {!lockedFromDevis && (
          <Button type="button" variant="outline" size="sm" onClick={() => append(emptyItem)}>
            <PlusIcon className="mr-1.5 size-3.5" />
            Ajouter un article
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Sous-total</span>
          <span className="tabular-nums">{fmt(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>TVA</span>
          <span className="tabular-nums">{fmt(totals.vatAmount)}</span>
        </div>
        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Remise totale</span>
            <span className="tabular-nums">−{fmt(totals.discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold pt-1 border-t">
          <span>Total</span>
          <span className="tabular-nums">{fmt(totals.total)}</span>
        </div>
      </div>

      <FormField
        label="Conditions de paiement"
        placeholder="ex: Paiement à 30 jours"
        error={errors.paymentTerms?.message}
        {...register("paymentTerms")}
      />

      <TextareaField
        label="Notes"
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
