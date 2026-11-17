"use client"

import { useRef, useState } from "react"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { reimbursementItemSchema, type ReimbursementItemInput } from "@/lib/schemas"
import { DateField } from "@/components/ui/date-field"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { DocumentUpload } from "@/components/ui/document-upload"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { Button } from "@/components/ui/button"
import { useFinanceCategories } from "@/hooks/use-finance-categories"

interface ReimbursementItemFormProps {
  defaultValues?: Partial<ReimbursementItemInput>
  onSubmit: (data: ReimbursementItemInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

// One expense line of a reimbursement request — mirrors expense-form.tsx's lazy-upload-at-save
// pattern (selecting a receipt only stashes a blob preview + the raw File; the actual R2 upload
// happens on save, so cancelling never leaves an orphaned object in storage).
export function ReimbursementItemForm({ defaultValues, onSubmit, onCancel, loading }: ReimbursementItemFormProps) {
  const t = useTranslations()

  const { data: categories = [] } = useFinanceCategories("EXPENSE")
  const categoryOptions = categories.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name }))

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<ReimbursementItemInput>({
    resolver: zodResolver(reimbursementItemSchema) as Resolver<ReimbursementItemInput>,
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
      description: "", amount: 0, categoryId: "", receiptUrl: "", isImmobilisation: false,
      ...defaultValues,
    },
  })

  const receiptUrl = watch("receiptUrl")
  const pendingFileRef = useRef<{ file: File; prefix: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  async function submit(data: ReimbursementItemInput) {
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
          toast.error(body.error ?? t("reimbursements.form.toasts.uploadError"))
          return
        }
        const { url } = await res.json()
        resolvedReceiptUrl = url
      } catch {
        toast.error(t("reimbursements.form.toasts.networkError"))
        return
      } finally {
        setUploading(false)
      }
    }
    await onSubmit({ ...data, receiptUrl: resolvedReceiptUrl, receiptFileName: pendingFileRef.current?.file.name ?? data.receiptFileName })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="date"
          control={control}
          render={({ field }) => (
            <DateField label={t("reimbursements.form.itemDate")} required value={field.value ?? ""} onChange={field.onChange} error={errors.date?.message} />
          )}
        />
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField label={t("reimbursements.form.itemAmount")} required value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.amount?.message} />
          )}
        />
      </div>

      <FormField label={t("reimbursements.form.itemDescription")} required error={errors.description?.message} {...register("description")} />

      <Controller
        name="categoryId"
        control={control}
        render={({ field }) => (
          <SelectField label={t("reimbursements.form.itemCategory")} required options={categoryOptions} value={field.value ?? ""} onValueChange={field.onChange} error={errors.categoryId?.message} />
        )}
      />

      <div>
        <label className="text-sm font-medium">
          {t("reimbursements.form.itemReceipt")}
          <span className="ml-0.5 text-destructive" aria-hidden>*</span>
        </label>
        <div className="mt-1.5">
          <DocumentUpload
            value={receiptUrl ?? ""}
            onChange={(url) => setValue("receiptUrl", url)}
            onFilePending={(_blobUrl, file, prefix) => { pendingFileRef.current = { file, prefix } }}
            prefix="reimbursement-receipts"
            capture="environment"
            lazy
          />
        </div>
        {errors.receiptUrl && <p className="mt-1 text-xs text-destructive">{errors.receiptUrl.message}</p>}
      </div>

      {/* Ticket: "compras que constituam um ativo imobilizado devem seguir o tratamento
          adequado na classe 2" — same flag/meaning as Expense's own, see ReimbursementItem's
          doc comment in schema.prisma. */}
      <CheckboxField
        label={t("finances.expenseForm.isImmobilisation")}
        description={t("finances.expenseForm.isImmobilisationHint")}
        {...register("isImmobilisation")}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading || uploading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading || uploading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
