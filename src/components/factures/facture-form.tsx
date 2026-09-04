"use client"

import { useEffect } from "react"
import { DateField } from "@/components/ui/date-field"
import { useForm, Controller, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
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
  const t = useTranslations()

  // PAYEE and PARTIELLEMENT_PAYEE aren't manual choices — the backend derives them from
  // amountPaid vs total (resolveManualStatus in facture-status.ts) the same way it derives
  // EN_RETARD, so picking one by hand here would just get silently overridden on save. They're
  // only ever offered once the facture already has a payment recorded (see `statusOptions`
  // below), at which point the field is locked anyway and this list just needs to include the
  // current value so the Select still shows its label.
  const allStatusOptions = [
    { value: "BROUILLON",           label: t("factures.form.status.brouillon")          },
    { value: "EN_ATTENTE",          label: t("factures.form.status.enAttente")          },
    { value: "PARTIELLEMENT_PAYEE", label: t("factures.form.status.partiellementPayee") },
    { value: "PAYEE",               label: t("factures.form.status.payee")              },
    { value: "ANNULEE",             label: t("factures.form.status.annulee")            },
  ]

  // Once a payment exists, PAYEE/PARTIELLEMENT_PAYEE are derived and shouldn't be
  // hand-picked — but the backend still allows cancelling a partially/fully paid facture
  // (ANNULEE passes through resolveManualStatus untouched), so the field must stay usable
  // for that instead of locking the whole Select.
  const statusLocked = amountPaid > 0
  const lockedStatus = defaultValues?.status
  const statusOptions = statusLocked
    ? allStatusOptions.filter(o => o.value === lockedStatus || o.value === "ANNULEE")
    : allStatusOptions.filter(o => o.value !== "PAYEE" && o.value !== "PARTIELLEMENT_PAYEE")

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
                label={t("documents.fournisseur")}
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
            <p className="text-sm font-medium">{t("documents.fournisseur")}</p>
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{t("documents.fournisseurModuleDisabled")}</p>
          </div>
        )}
        <div className="space-y-1.5">
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
          {statusLocked && (
            <p className="text-xs text-muted-foreground">{t("factures.form.statusLockedNotice")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="issueDate"
          control={control}
          render={({ field }) => (
            <DateField label={t("documents.issueDate")} required value={field.value ?? ""} onChange={field.onChange} error={errors.issueDate?.message} />
          )}
        />
        <Controller
          name="dueDate"
          control={control}
          render={({ field }) => (
            <DateField label={t("factures.form.dueDate")} allowFuture value={field.value ?? ""} onChange={field.onChange} error={errors.dueDate?.message} />
          )}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("documents.items")}</p>
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="rounded-lg border p-3 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <FormField
                    label={t("documents.itemDescription")}
                    placeholder={t("documents.itemDescription")}
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
                  label={t("documents.quantity")}
                  type="number"
                  step="0.01"
                  min="0"
                  error={errors.items?.[index]?.quantity?.message}
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                  disabled={lockedFromDevis}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">{t("documents.unitPrice")}</p>
                  <Controller
                    name={`items.${index}.unitPrice`}
                    control={control}
                    render={({ field }) => <CurrencyInput value={field.value} onChange={field.onChange} disabled={lockedFromDevis} />}
                  />
                </div>
                <FormField
                  label={t("documents.vatRate")}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  error={errors.items?.[index]?.vatRate?.message}
                  {...register(`items.${index}.vatRate`, { valueAsNumber: true })}
                  disabled={lockedFromDevis}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">{t("documents.discount")}</p>
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
            {t("documents.addItem")}
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>{t("documents.subtotal")}</span>
          <span className="tabular-nums">{fmt(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{t("documents.vat")}</span>
          <span className="tabular-nums">{fmt(totals.vatAmount)}</span>
        </div>
        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>{t("documents.totalDiscount")}</span>
            <span className="tabular-nums">−{fmt(totals.discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold pt-1 border-t">
          <span>{t("documents.total")}</span>
          <span className="tabular-nums">{fmt(totals.total)}</span>
        </div>
      </div>

      <FormField
        label={t("documents.paymentTerms")}
        placeholder={t("documents.paymentTermsPlaceholder")}
        error={errors.paymentTerms?.message}
        {...register("paymentTerms")}
      />

      <TextareaField
        label={t("documents.notes")}
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
