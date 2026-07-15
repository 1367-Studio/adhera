"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast }  from "sonner"

interface Props {
  associationId: string
  plan:          "ESSENTIAL" | "PRO"
  initialValue:  boolean | null
}

const OPTIONS: { value: boolean | null; label: string }[] = [
  { value: null,  label: "Par défaut (selon la formule)" },
  { value: true,  label: "Forcer activé" },
  { value: false, label: "Forcer désactivé" },
]

export function CustomBrandingEditor({ associationId, plan, initialValue }: Props) {
  const [value, setValue]           = useState(initialValue)
  const [saved, setSaved]           = useState(initialValue)
  const [pending, startTransition]  = useTransition()

  const isDirty = value !== saved

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/backoffice/associations/${associationId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ customBrandingEnabled: value }),
      })
      if (res.ok) {
        setSaved(value)
        toast.success("Personnalisation de marque mise à jour")
      } else {
        toast.error("Erreur lors de la sauvegarde")
      }
    })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Par défaut, le logo et les couleurs personnalisés (dashboard, devis/factures,
        feuille de présence) sont réservés à la formule Pro (formule actuelle :{" "}
        {plan === "PRO" ? "Pro" : "Essentiel"}). Forcer permet de l&apos;activer ou
        désactiver pour cette association précisément, sans changer sa formule.
      </p>
      <div className="flex items-center gap-2">
        <select
          value={value === null ? "default" : String(value)}
          onChange={e => setValue(e.target.value === "default" ? null : e.target.value === "true")}
          disabled={pending}
          className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
        >
          {OPTIONS.map(o => (
            <option key={String(o.value)} value={o.value === null ? "default" : String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={save} loading={pending} disabled={!isDirty || pending}>
          Sauvegarder
        </Button>
      </div>
    </div>
  )
}
