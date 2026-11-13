"use client"

import { useEffect, useRef, useState } from "react"
import { DateField } from "@/components/ui/date-field"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { factureRecueSchema, type FactureRecueInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { DocumentUpload } from "@/components/ui/document-upload"
import { Button } from "@/components/ui/button"

interface FactureRecueFormProps {
  defaultValues?: Partial<FactureRecueInput>
  onSubmit: (data: FactureRecueInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function FactureRecueForm({ defaultValues, onSubmit, onCancel, loading }: FactureRecueFormProps) {
  const t = useTranslations()

  const typeOptions = [
    { value: "facture",     label: t("fournisseurs.detail.documentTypes.facture")     },
    { value: "devis_recu",  label: t("fournisseurs.detail.documentTypes.devisRecu")   },
    { value: "comprovante", label: t("fournisseurs.detail.documentTypes.comprovante") },
    { value: "contrat",     label: t("fournisseurs.detail.documentTypes.contrat")     },
    { value: "autre",       label: t("fournisseurs.detail.documentTypes.autre")       },
  ]

  // PAYEE/PARTIELLEMENT_PAYEE aren't manual choices (FORM-107 Fase 3) — the backend derives
  // them from amountPaid vs amount (resolveManualFactureRecueStatus), the same way Facture's
  // own form excludes them (see facture-form.tsx). This form only ever creates a document, and
  // a brand-new one always starts at amountPaid=0 — "already paid" is recorded as a real
  // payment right after creation instead (see the "Enregistrer un paiement" row action).
  const statusOptions = [
    { value: "A_PAYER",   label: t("fournisseurs.document.statusOptions.aPayer")   },
    { value: "EN_LITIGE", label: t("fournisseurs.document.statusOptions.enLitige") },
    { value: "ANNULEE",   label: t("fournisseurs.document.statusOptions.annulee")  },
  ]

  const { register, control, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FactureRecueInput>({
    resolver: zodResolver(factureRecueSchema),
    defaultValues: {
      type:      "facture",
      status:    "A_PAYER",
      issueDate: new Date().toISOString().split("T")[0],
      fileUrl:   "",
      ...defaultValues,
    },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({
      type:      "facture",
      status:    "A_PAYER",
      issueDate: new Date().toISOString().split("T")[0],
      fileUrl:   "",
      ...defaultValues,
    })
  }, [defaultValues, reset])

  const fileUrl       = watch("fileUrl")
  const pendingFileRef = useRef<{ file: File; prefix: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  // The DocumentUpload field is `lazy`: selecting a file only creates a local blob preview
  // and stashes the raw File here — nothing is actually uploaded to R2 until Save is
  // pressed, so cancelling the form or swapping to a different file never leaves an
  // orphaned object in storage (see [[project-devis-facture-fournisseur-modules]]).
  async function submit(data: FactureRecueInput) {
    let resolvedFileUrl = data.fileUrl
    if (resolvedFileUrl.startsWith("blob:") && pendingFileRef.current) {
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append("file", pendingFileRef.current.file)
        fd.append("prefix", pendingFileRef.current.prefix)
        const res = await fetch("/api/upload", { method: "POST", body: fd })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body.error ?? t("fournisseurs.document.toasts.uploadError"))
          return
        }
        const { url } = await res.json()
        resolvedFileUrl = url
      } catch {
        toast.error(t("fournisseurs.document.toasts.networkError"))
        return
      } finally {
        setUploading(false)
      }
    }
    await onSubmit({ ...data, fileUrl: resolvedFileUrl })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <SelectField label={t("fournisseurs.document.type")} required options={typeOptions} value={field.value} onValueChange={field.onChange} error={errors.type?.message} />
          )}
        />
        <FormField label={t("fournisseurs.document.number")} placeholder={t("fournisseurs.document.numberPlaceholder")} error={errors.number?.message} {...register("number")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
<Controller
          name="issueDate"
          control={control}
          render={({ field }) => (
            <DateField label={t("fournisseurs.document.date")} required value={field.value ?? ""} onChange={field.onChange} error={errors.issueDate?.message} />
          )}
        />
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField label={t("fournisseurs.document.amount")} required value={field.value ?? 0} onChange={field.onChange} error={errors.amount?.message} />
          )}
        />
      </div>

      <Controller
        name="status"
        control={control}
        render={({ field }) => (
          <SelectField label={t("membres.form.fields.status")} required options={statusOptions} value={field.value} onValueChange={field.onChange} error={errors.status?.message} />
        )}
      />
      <div>
        <label className="text-sm font-medium">{t("fournisseurs.document.file")}</label>
        <div className="mt-1.5">
          <DocumentUpload
            value={fileUrl ?? ""}
            onChange={(url) => setValue("fileUrl", url, { shouldValidate: true })}
            onFilePending={(_blobUrl, file, prefix) => { pendingFileRef.current = { file, prefix } }}
            lazy
            prefix="factures-recues"
          />
        </div>
        {errors.fileUrl?.message && <p className="mt-1 text-xs text-destructive">{errors.fileUrl.message}</p>}
      </div>

      <TextareaField label={t("documents.notes")} rows={3} error={errors.notes?.message} {...register("notes")} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading || uploading}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={loading || uploading}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  )
}
