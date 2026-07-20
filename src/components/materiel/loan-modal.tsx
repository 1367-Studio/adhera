"use client"

import { useEffect, useRef, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { useCreateLoan, type Material } from "@/hooks/use-materiel"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"

const schema = z.object({
  borrowerType:     z.enum(["membre", "externe"]),
  membreId:         z.string().optional(),
  borrowerName:     z.string().max(150).optional(),
  quantity:         z.number().int().min(1),
  borrowedAt:       z.string().optional(),
  expectedReturnAt: z.string().optional(),
  feeAmount:        z.number().optional(),
  notes:            z.string().max(500).optional(),
}).superRefine((v, ctx) => {
  if (v.borrowerType === "membre" && !v.membreId) {
    ctx.addIssue({ code: "custom", path: ["membreId"], message: "Requis" })
  }
  if (v.borrowerType === "externe" && !v.borrowerName?.trim()) {
    ctx.addIssue({ code: "custom", path: ["borrowerName"], message: "Requis" })
  }
  if (v.borrowedAt && v.expectedReturnAt && v.expectedReturnAt < v.borrowedAt) {
    ctx.addIssue({ code: "custom", path: ["expectedReturnAt"], message: "Doit être après la date de sortie" })
  }
})

type FormValues = z.infer<typeof schema>
type MembreOption = { id: string; firstName: string; lastName: string }

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  material:     Material
}

export function LoanModal({ open, onOpenChange, material }: Props) {
  const createLoan = useCreateLoan(material.id)

  const { data: membres = [] } = useQuery<MembreOption[]>({
    queryKey: ["membres-active"],
    queryFn:  () => fetch("/api/membres?status=ACTIF&limit=500").then(r => r.json()),
  })

  const { register, handleSubmit, reset, watch, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: { borrowerType: "membre", quantity: 1, borrowedAt: new Date().toISOString().slice(0, 10) },
  })

  const borrowerType = watch("borrowerType")
  const borrowedAt   = watch("borrowedAt")
  const quantity     = watch("quantity") || 1
  const feeAmount    = watch("feeAmount")
  const feeTotal     = feeAmount ? feeAmount * quantity : NaN

  // availableQty only reflects today's stock (loans that have already started, see the
  // materiel API) — it says nothing about a future-dated reservation, which the backend's
  // own capacity check evaluates against that later date instead.
  const todayStr      = new Date().toISOString().slice(0, 10)
  const isFutureDate  = !!borrowedAt && borrowedAt > todayStr
  const noCapacityNow = material.availableQty === 0 && !isFutureDate

  // Read via a ref instead of a dependency so a background refetch of `material` while the
  // modal is already open (e.g. window refocus, another admin editing the rate) can't
  // re-trigger this reset and wipe out whatever the user has already typed.
  const rentalRateRef = useRef(material.rentalRate)
  rentalRateRef.current = material.rentalRate

  useEffect(() => {
    if (open) reset({
      borrowerType: "membre",
      quantity:     1,
      borrowedAt:   new Date().toISOString().slice(0, 10),
      feeAmount:    rentalRateRef.current ? Number(rentalRateRef.current) : 0,
    })
  }, [open, reset])

  async function onSubmit(values: FormValues) {
    try {
      await createLoan.mutateAsync({
        membreId:         values.borrowerType === "membre" ? values.membreId : null,
        borrowerName:     values.borrowerType === "externe" ? values.borrowerName : null,
        quantity:         values.quantity,
        borrowedAt:       values.borrowedAt,
        expectedReturnAt: values.expectedReturnAt || null,
        feeAmount:        values.feeAmount || null,
        notes:            values.notes || null,
      })
      toast.success("Prêt enregistré")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const membreOptions = membres.map(m => ({ value: m.id, label: `${m.firstName} ${m.lastName}` }))
  const isPending     = isSubmitting || createLoan.isPending

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Enregistrer un prêt — ${material.name}`} size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

        <p className="text-sm text-muted-foreground">
          {material.availableQty} unité{material.availableQty !== 1 ? "s" : ""} disponible{material.availableQty !== 1 ? "s" : ""} sur {material.quantity}
        </p>

        {/* Borrower type toggle */}
        <Controller
          name="borrowerType"
          control={control}
          render={({ field }) => (
            <div className="flex rounded-lg border p-1 gap-1">
              {(["membre", "externe"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => field.onChange(t)}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-sm font-medium transition-colors",
                    field.value === t
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "membre" ? "Membre" : "Personne externe"}
                </button>
              ))}
            </div>
          )}
        />

        {borrowerType === "membre" ? (
          <Controller
            name="membreId"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Membre"
                required
                options={membreOptions}
                value={field.value}
                onValueChange={field.onChange}
                placeholder="Sélectionner un membre…"
                error={errors.membreId?.message}
              />
            )}
          />
        ) : (
          <FormField
            label="Nom de l'emprunteur"
            required
            placeholder="Jean Dupont"
            error={errors.borrowerName?.message}
            {...register("borrowerName")}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date de sortie" type="date" {...register("borrowedAt")} />
          <FormField label="Retour prévu" type="date" min={borrowedAt} error={errors.expectedReturnAt?.message} {...register("expectedReturnAt")} />
        </div>
        {isFutureDate && (
          <p className="text-xs text-muted-foreground -mt-2">
            Date future : l'article sera enregistré comme réservé jusqu'à cette date.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          {material.quantity > 1 && (
            <FormField
              label="Quantité empruntée"
              type="number"
              min={1}
              max={isFutureDate ? material.quantity : material.availableQty}
              error={errors.quantity?.message}
              {...register("quantity", { valueAsNumber: true })}
            />
          )}
          <Controller
            name="feeAmount"
            control={control}
            render={({ field }) => (
              <CurrencyField
                label={material.quantity > 1 ? "Tarif du prêt (€ / unité)" : "Montant du prêt (€)"}
                value={field.value ?? 0}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errors.feeAmount?.message}
              />
            )}
          />
        </div>
        {material.quantity > 1 && quantity > 1 && !isNaN(feeTotal) && feeTotal > 0 && (
          <p className="text-xs text-muted-foreground -mt-2">
            Montant facturé : {quantity} × {feeAmount!.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} = {feeTotal.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
          </p>
        )}

        <FormField label="Notes" placeholder="Usage prévu, état au départ…" {...register("notes")} />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Annuler</Button>
          <Button type="submit" loading={isPending} disabled={noCapacityNow}>
            {noCapacityNow ? "Aucune unité disponible" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
