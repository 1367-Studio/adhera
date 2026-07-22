"use client"

import { useEffect, useRef, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { factureRecueSchema, type FactureRecueInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { DocumentUpload } from "@/components/ui/document-upload"
import { Button } from "@/components/ui/button"

const typeOptions = [
  { value: "facture",     label: "Facture"     },
  { value: "devis_recu",  label: "Devis reçu"  },
  { value: "comprovante", label: "Justificatif" },
  { value: "contrat",     label: "Contrat"     },
  { value: "autre",       label: "Autre"       },
]

const statusOptions = [
  { value: "A_PAYER",   label: "À payer"    },
  { value: "PAYEE",     label: "Payée"      },
  { value: "EN_LITIGE", label: "En litige"  },
  { value: "ANNULEE",   label: "Annulée"    },
]

interface FactureRecueFormProps {
  defaultValues?: Partial<FactureRecueInput>
  onSubmit: (data: FactureRecueInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function FactureRecueForm({ defaultValues, onSubmit, onCancel, loading }: FactureRecueFormProps) {
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
  const watchedStatus = watch("status")
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
          toast.error(body.error ?? "Erreur lors de l'upload du document")
          return
        }
        const { url } = await res.json()
        resolvedFileUrl = url
      } catch {
        toast.error("Erreur réseau lors de l'upload — réessayez")
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
            <SelectField label="Type" required options={typeOptions} value={field.value} onValueChange={field.onChange} error={errors.type?.message} />
          )}
        />
        <FormField label="N° du document" placeholder="Référence fournisseur" error={errors.number?.message} {...register("number")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Date" type="date" required error={errors.issueDate?.message} {...register("issueDate")} />
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField label="Montant" required value={field.value ?? 0} onChange={field.onChange} error={errors.amount?.message} />
          )}
        />
      </div>

      <Controller
        name="status"
        control={control}
        render={({ field }) => (
          <SelectField label="Statut" required options={statusOptions} value={field.value} onValueChange={field.onChange} error={errors.status?.message} />
        )}
      />
      {defaultValues?.status === "PAYEE" && watchedStatus !== "PAYEE" && (
        <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          Ce document est actuellement payée — retirer ce statut supprimera la dépense qu&apos;il a générée dans Finances, ainsi que sa réconciliation bancaire éventuelle.
        </p>
      )}
      {defaultValues?.status !== "PAYEE" && watchedStatus === "PAYEE" && (
        <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
          Marquer ce document comme payée créera automatiquement une dépense correspondante dans Finances.
        </p>
      )}

      <div>
        <label className="text-sm font-medium">Document</label>
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

      <TextareaField label="Notes" rows={3} error={errors.notes?.message} {...register("notes")} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading || uploading}>
          Annuler
        </Button>
        <Button type="submit" loading={loading || uploading}>
          Enregistrer
        </Button>
      </div>
    </form>
  )
}
