"use client"

import { useEffect } from "react"
import { useForm, Controller, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { devisSchema, type DevisInput } from "@/lib/schemas"
import { useFournisseursList } from "@/hooks/use-fournisseurs"
import { buildFournisseurOptions } from "@/lib/fournisseur-options"
import { computeDocumentTotals } from "@/lib/devis-calc"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { CurrencyInput } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { useModules } from "@/lib/user-context"

const statusOptions = [
  { value: "BROUILLON", label: "Brouillon" },
  { value: "ENVOYE",    label: "Envoyé"    },
  { value: "ACCEPTE",   label: "Accepté"   },
  { value: "REFUSE",    label: "Refusé"    },
  { value: "EXPIRE",    label: "Expiré"    },
]

const emptyItem = { description: "", quantity: 1, unitPrice: 0, vatRate: 20, discount: 0 }

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

interface DevisFormProps {
  defaultValues?: Partial<DevisInput>
  onSubmit: (data: DevisInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
  /** Set when the devis has already been converted to a facture — locks the items, which
   *  are now frozen as a snapshot on that facture and can no longer affect it. */
  itemsLocked?: boolean
}

export function DevisForm({ defaultValues, onSubmit, onCancel, loading, itemsLocked }: DevisFormProps) {
  const modules = useModules()
  const { data: fournisseurs = [] } = useFournisseursList(defaultValues?.fournisseurId || undefined, modules.fournisseurs)

  const { register, control, handleSubmit, reset, watch, formState: { errors } } = useForm<DevisInput>({
    resolver: zodResolver(devisSchema),
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
              />
            )}
          />
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Fournisseur</p>
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Module Fournisseurs désactivé</p>
          </div>
        )}
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

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Date d'émission"
          type="date"
          required
          error={errors.issueDate?.message}
          {...register("issueDate")}
        />
        <FormField
          label="Valide jusqu'au"
          type="date"
          error={errors.validUntil?.message}
          {...register("validUntil")}
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
                    disabled={itemsLocked}
                  />
                </div>
                {!itemsLocked && (
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
                  disabled={itemsLocked}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Prix unitaire</p>
                  <Controller
                    name={`items.${index}.unitPrice`}
                    control={control}
                    render={({ field }) => <CurrencyInput value={field.value} onChange={field.onChange} disabled={itemsLocked} />}
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
                  disabled={itemsLocked}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Remise</p>
                  <Controller
                    name={`items.${index}.discount`}
                    control={control}
                    render={({ field }) => <CurrencyInput value={field.value} onChange={field.onChange} disabled={itemsLocked} />}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        {errors.items?.message && <p className="text-xs text-destructive">{errors.items.message}</p>}
        {!itemsLocked && (
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
