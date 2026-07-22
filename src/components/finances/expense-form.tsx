"use client"

import { useEffect, useRef, useState } from "react"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { expenseSchema, type ExpenseInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { DocumentUpload } from "@/components/ui/document-upload"
import { Button } from "@/components/ui/button"
import { useFinanceCategories } from "@/hooks/use-finance-categories"

const statusOptions = [
  { value: "DRAFT",     label: "Brouillon" },
  { value: "VALIDATED", label: "Validée" },
  { value: "CANCELLED", label: "Annulée" },
]

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
  const { data: categories = [] } = useFinanceCategories("EXPENSE")
  const categoryOptions = [
    { value: "", label: "Aucune catégorie" },
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
          toast.error(body.error ?? "Erreur lors de l'upload du justificatif")
          return
        }
        const { url } = await res.json()
        resolvedReceiptUrl = url
      } catch {
        toast.error("Erreur réseau lors de l'upload — réessayez")
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
          Montant, date, statut et fournisseur viennent de la facture reçue d&apos;origine — modifiez-les depuis Fournisseurs. Catégorie et notes restent modifiables ici.
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
            <SelectField label="Catégorie" options={categoryOptions} value={field.value ?? ""} onValueChange={field.onChange} />
          )}
        />
        <FormField label="Fournisseur" placeholder="Ex: Décathlon" disabled={locked} error={errors.vendor?.message} {...register("vendor")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <SelectField label="Statut" options={statusOptions} disabled={locked} value={field.value ?? "DRAFT"} onValueChange={field.onChange} />
          )}
        />
        <div />
      </div>

      <FormField label="Description" placeholder="Ex: Achat matériel sportif" error={errors.description?.message} {...register("description")} />
      <FormField label="Note interne" placeholder="Note pour le trésorier…" error={errors.internalNote?.message} {...register("internalNote")} />

      <div>
        <label className="text-sm font-medium">Justificatif</label>
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
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading || uploading}>Annuler</Button>
        <Button type="submit" loading={loading || uploading}>Enregistrer</Button>
      </div>
    </form>
  )
}
