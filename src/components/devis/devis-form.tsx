"use client"

import { useEffect } from "react"
import { DateField } from "@/components/ui/date-field"
import { useForm, Controller, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
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
  const t = useTranslations()

  const statusOptions = [
    { value: "BROUILLON", label: t("devis.form.status.brouillon") },
    { value: "ENVOYE",    label: t("devis.form.status.envoye")    },
    { value: "ACCEPTE",   label: t("devis.form.status.accepte")   },
    { value: "REFUSE",    label: t("devis.form.status.refuse")    },
    { value: "EXPIRE",    label: t("devis.form.status.expire")    },
  ]

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
                label={t("documents.fournisseur")}
                options={fournisseurOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={errors.fournisseurId?.message}
              />
            )}
          />
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("documents.fournisseur")}</p>
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{t("documents.fournisseurModuleDisabled")}</p>
          </div>
        )}
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

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="issueDate"
          control={control}
          render={({ field }) => (
            <DateField label={t("documents.issueDate")} required value={field.value ?? ""} onChange={field.onChange} error={errors.issueDate?.message} />
          )}
        />
        {/* allowFuture : une date de validité est par nature postérieure à aujourd'hui. */}
        <Controller
          name="validUntil"
          control={control}
          render={({ field }) => (
            <DateField label={t("devis.form.validUntil")} allowFuture value={field.value ?? ""} onChange={field.onChange} error={errors.validUntil?.message} />
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
                  label={t("documents.quantity")}
                  type="number"
                  step="0.01"
                  min="0"
                  error={errors.items?.[index]?.quantity?.message}
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                  disabled={itemsLocked}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">{t("documents.unitPrice")}</p>
                  <Controller
                    name={`items.${index}.unitPrice`}
                    control={control}
                    render={({ field }) => <CurrencyInput value={field.value} onChange={field.onChange} disabled={itemsLocked} />}
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
                  disabled={itemsLocked}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">{t("documents.discount")}</p>
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
