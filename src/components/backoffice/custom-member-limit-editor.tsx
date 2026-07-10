"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast }  from "sonner"

interface Props {
  associationId: string
  standardLimit: number
  initialLimit:  number | null
}

export function CustomMemberLimitEditor({ associationId, standardLimit, initialLimit }: Props) {
  const [value,  setValue]  = useState(initialLimit != null ? String(initialLimit) : "")
  const [saved,  setSaved]  = useState(initialLimit)
  const [pending, startTransition] = useTransition()

  const parsed  = value.trim() === "" ? null : Number(value)
  const isValid = parsed === null || (Number.isInteger(parsed) && parsed > 0)
  const isDirty = isValid && parsed !== saved

  function save() {
    if (!isValid) return
    startTransition(async () => {
      const res = await fetch(`/api/backoffice/associations/${associationId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ customMemberLimit: parsed }),
      })
      if (res.ok) {
        setSaved(parsed)
        toast.success(parsed ? "Limite personnalisée enregistrée" : "Retour à la limite standard")
      } else {
        toast.error("Erreur lors de la sauvegarde")
      }
    })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Limite standard de la formule : {standardLimit} membres actifs. Laisser vide pour l&apos;utiliser telle quelle.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          step={1}
          placeholder={String(standardLimit)}
          value={value}
          onChange={e => setValue(e.target.value)}
          disabled={pending}
          className="w-32 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
        />
        <span className="text-sm text-muted-foreground">membres (sur mesure)</span>
        <Button size="sm" onClick={save} loading={pending} disabled={!isDirty || pending}>
          Sauvegarder
        </Button>
      </div>
      {!isValid && <p className="text-xs text-destructive">Doit être un nombre entier positif.</p>}
    </div>
  )
}
