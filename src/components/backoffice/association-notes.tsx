"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast }  from "sonner"

interface Props {
  associationId: string
  initialNotes:  string
}

export function AssociationNotes({ associationId, initialNotes }: Props) {
  const [notes,  setNotes]  = useState(initialNotes)
  const [saved,  setSaved]  = useState(initialNotes)
  const [pending, startTransition] = useTransition()
  const isDirty = notes !== saved

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/backoffice/associations/${associationId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ internalNotes: notes }),
      })
      if (res.ok) {
        setSaved(notes)
        toast.success("Notes sauvegardées")
      } else {
        toast.error("Erreur lors de la sauvegarde")
      }
    })
  }

  return (
    <div className="space-y-3">
      <textarea
        className="w-full min-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y disabled:opacity-60"
        placeholder="Notes internes sur cette association…"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        disabled={pending}
      />
      <Button size="sm" onClick={save} loading={pending} disabled={!isDirty || pending}>
        Sauvegarder
      </Button>
    </div>
  )
}
