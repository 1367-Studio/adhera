"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import type { AssocModules } from "@/lib/modules"
import { MODULE_LABELS } from "@/lib/modules"
import { Button } from "@/components/ui/button"
import { AlertTriangleIcon } from "lucide-react"

interface Props {
  associationId:  string
  initialModules: AssocModules
}

export function ModuleToggles({ associationId, initialModules }: Props) {
  const [saved,   setSaved]   = useState<AssocModules>(initialModules)
  const [modules, setModules] = useState<AssocModules>(initialModules)
  const [pending, startTransition] = useTransition()
  const isDirty = JSON.stringify(modules) !== JSON.stringify(saved)

  function toggle(key: keyof AssocModules) {
    setModules(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function save() {
    startTransition(async () => {
      const snapshot = modules
      const res = await fetch(`/api/backoffice/associations/${associationId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ modules: snapshot }),
      })
      if (res.ok) {
        setSaved(snapshot)
        toast.success("Modules mis à jour")
      } else {
        setModules(saved) // rollback to last saved state
        toast.error("Erreur lors de la sauvegarde")
      }
    })
  }

  return (
    <div className="space-y-3">
      {(Object.keys(MODULE_LABELS) as (keyof AssocModules)[]).map(key => (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm">{MODULE_LABELS[key]}</span>
            <button
              type="button"
              onClick={() => !pending && toggle(key)}
              aria-checked={modules[key]}
              role="switch"
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                modules[key] ? "bg-foreground" : "bg-muted"
              } ${pending ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span className={`pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${modules[key] ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </div>
          {key === "site" && !modules[key] && saved[key] && (
            <p className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangleIcon className="size-3 shrink-0" />
              Désactiver retirera le site public immédiatement.
            </p>
          )}
        </div>
      ))}
      {isDirty && (
        <Button size="sm" onClick={save} loading={pending} disabled={pending}>
          Sauvegarder
        </Button>
      )}
    </div>
  )
}
