"use client"

import { useEffect, useRef, useState } from "react"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { expenseSchema, type ExpenseInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { useFinanceCategories } from "@/hooks/use-finance-categories"
import { toast } from "sonner"
import { UploadSimpleIcon, FileIcon, XIcon, ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
const statusOptions = [
  { value: "DRAFT",     label: "Brouillon" },
  { value: "VALIDATED", label: "Validée" },
  { value: "CANCELLED", label: "Annulée" },
]

function ReceiptUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (file.size > 10 * 1024 * 1024) { toast.error("Fichier trop volumineux (max 10 Mo)"); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("prefix", "receipts")
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? "Erreur lors de l'upload")
        return
      }
      const { url } = await res.json()
      onChange(url)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const isPdf = value.toLowerCase().includes(".pdf") || value.toLowerCase().includes("application%2Fpdf")

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm">
          {isPdf ? "Facture PDF" : "Justificatif image"}
        </span>
        <a href={value} target="_blank" rel="noopener noreferrer" title="Voir le justificatif">
          <ArrowSquareOutIcon className="size-4 text-muted-foreground hover:text-foreground" />
        </a>
        <button type="button" onClick={() => onChange("")} title="Supprimer">
          <XIcon className="size-4 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    )
  }

  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground transition-colors">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
      {uploading
        ? <span className="text-xs">Upload en cours…</span>
        : <><UploadSimpleIcon className="size-4 shrink-0" /><span>Joindre image ou PDF (max 10 Mo)</span></>
      }
    </label>
  )
}

interface ExpenseFormProps {
  defaultValues?: Partial<ExpenseInput>
  onSubmit:  (data: ExpenseInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
}

export function ExpenseForm({ defaultValues, onSubmit, onCancel, loading }: ExpenseFormProps) {
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField label="Montant" required value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.amount?.message} />
          )}
        />
        <FormField label="Date" type="date" required error={errors.date?.message} {...register("date")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="categoryId"
          control={control}
          render={({ field }) => (
            <SelectField label="Catégorie" options={categoryOptions} value={field.value ?? ""} onValueChange={field.onChange} />
          )}
        />
        <FormField label="Fournisseur" placeholder="Ex: Décathlon" error={errors.vendor?.message} {...register("vendor")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <SelectField label="Statut" options={statusOptions} value={field.value ?? "DRAFT"} onValueChange={field.onChange} />
          )}
        />
        <div />
      </div>

      <FormField label="Description" placeholder="Ex: Achat matériel sportif" error={errors.description?.message} {...register("description")} />
      <FormField label="Note interne" placeholder="Note pour le trésorier…" error={errors.internalNote?.message} {...register("internalNote")} />

      <div>
        <label className="text-sm font-medium">Justificatif</label>
        <div className="mt-1">
          <ReceiptUpload value={receiptUrl ?? ""} onChange={(url) => setValue("receiptUrl", url)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Annuler</Button>
        <Button type="submit" loading={loading}>Enregistrer</Button>
      </div>
    </form>
  )
}
