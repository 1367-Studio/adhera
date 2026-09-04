"use client"

import { useEffect, useRef, useState } from "react"
import { DateField } from "@/components/ui/date-field"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { expenseSchema, type ExpenseInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { DocumentUpload } from "@/components/ui/document-upload"
import { Button } from "@/components/ui/button"
import { useFinanceCategories } from "@/hooks/use-finance-categories"

interface ExpenseFormProps {
  defaultValues?: Partial<ExpenseInput>
  onSubmit:  (data: ExpenseInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
  // True when this row was auto-created from a FactureRecue marked payée — amount/date/
  // status/vendor mirror that document, so they're locked here; category/notes stay
  // editable since they're association-side annotations.
  locked?: boolean
}

export function ExpenseForm({ defaultValues, onSubmit, onCancel, loading, locked }: ExpenseFormProps) {
  const t = useTranslations()

  const statusOptions = [
    { value: "DRAFT",     label: t("finances.expenseForm.status.draft")     },
    { value: "VALIDATED", label: t("finances.expenseForm.status.validated") },
    { value: "CANCELLED", label: t("finances.expenseForm.status.cancelled") },
  ]

  const paymentMethodOptions = [
    { value: "",         label: t("finances.incomeForm.paymentMethod.none")     },
    { value: "VIREMENT", label: t("finances.incomeForm.paymentMethod.virement") },
    { value: "CHEQUE",   label: t("finances.incomeForm.paymentMethod.cheque")   },
    { value: "ESPECES",  label: t("finances.incomeForm.paymentMethod.especes")  },
    { value: "STRIPE",   label: t("finances.incomeForm.paymentMethod.stripe")  },
    { value: "AUTRE",    label: t("finances.incomeForm.paymentMethod.autre")   },
  ]

  const { data: categories = [] } = useFinanceCategories("EXPENSE")
  const categoryOptions = [
    { value: "", label: t("finances.incomeForm.noCategory") },
    ...categories.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name })),
  ]

  const { register, control, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema) as Resolver<ExpenseInput>,
    defaultValues: {
      date:   new Date().toISOString().split("T")[0],
      status: "DRAFT",
      ...defaultValues,
    },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ date: new Date().toISOString().split("T")[0], status: "DRAFT", ...defaultValues })
  }, [defaultValues, reset])

  const receiptUrl = watch("receiptUrl")
  const pendingFileRef = useRef<{ file: File; prefix: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  // The DocumentUpload field is `lazy`: selecting a file only creates a local blob preview
  // and stashes the raw File here — nothing is actually uploaded to R2 until Save is
  // pressed, so cancelling the form or swapping to a different file never leaves an
  // orphaned object in storage (see [[project-devis-facture-fournisseur-modules]]).
  async function submit(data: ExpenseInput) {
    let resolvedReceiptUrl = data.receiptUrl
    if (resolvedReceiptUrl?.startsWith("blob:") && pendingFileRef.current) {
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append("file", pendingFileRef.current.file)
        fd.append("prefix", pendingFileRef.current.prefix)
        const res = await fetch("/api/upload", { method: "POST", body: fd })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body.error ?? t("finances.expenseForm.toasts.uploadError"))
          return
        }
        const { url } = await res.json()
        resolvedReceiptUrl = url
      } catch {
        toast.error(t("finances.expenseForm.toasts.networkError"))
        return
      } finally {
        setUploading(false)
      }
    }
    await onSubmit({ ...data, receiptUrl: resolvedReceiptUrl })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      {locked && (
        <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
          {t("finances.expenseForm.lockedNotice")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField label={t("finances.incomeForm.amount")} required disabled={locked} value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.amount?.message} />
          )}
        />
<Controller
          name="date"
          control={control}
          render={({ field }) => (
            <DateField label={t("finances.incomeForm.date")} required disabled={locked} value={field.value ?? ""} onChange={field.onChange} error={errors.date?.message} />
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="categoryId"
          control={control}
          render={({ field }) => (
            <SelectField label={t("finances.incomeForm.category")} options={categoryOptions} value={field.value ?? ""} onValueChange={field.onChange} />
          )}
        />
        <FormField label={t("finances.expenseForm.vendor")} placeholder={t("finances.expenseForm.vendorPlaceholder")} disabled={locked} error={errors.vendor?.message} {...register("vendor")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <SelectField label={t("membres.form.fields.status")} options={statusOptions} disabled={locked} value={field.value ?? "DRAFT"} onValueChange={field.onChange} />
          )}
        />
        <Controller
          name="paymentMethod"
          control={control}
          render={({ field }) => (
            <SelectField label={t("finances.incomeForm.paymentMethodLabel")} options={paymentMethodOptions} value={field.value ?? ""} onValueChange={field.onChange} />
          )}
        />
      </div>

      <FormField label={t("finances.incomeForm.description")} placeholder={t("finances.expenseForm.descriptionPlaceholder")} error={errors.description?.message} {...register("description")} />
      <FormField label={t("finances.expenseForm.internalNote")} placeholder={t("finances.expenseForm.internalNotePlaceholder")} error={errors.internalNote?.message} {...register("internalNote")} />

      <div>
        <label className="text-sm font-medium">{t("finances.expenseForm.receipt")}</label>
        <div className="mt-1">
          <DocumentUpload
            value={receiptUrl ?? ""}
            onChange={(url) => setValue("receiptUrl", url)}
            onFilePending={(_blobUrl, file, prefix) => { pendingFileRef.current = { file, prefix } }}
            lazy
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading || uploading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading || uploading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
