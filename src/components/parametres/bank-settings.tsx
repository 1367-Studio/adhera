"use client"

import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"

type BankData = {
  website: string | null
  iban:    string | null
  bic:     string | null
}

interface BankSettingsProps {
  canEdit: boolean
  data:    BankData
}

export function BankSettings({ canEdit, data }: BankSettingsProps) {
  const qc = useQueryClient()

  const [website, setWebsite] = useState(data.website ?? "")
  const [iban, setIban]       = useState(data.iban ?? "")
  const [bic, setBic]         = useState(data.bic ?? "")
  const [dirty, setDirty]     = useState(false)

  useEffect(() => {
    setWebsite(data.website ?? "")
    setIban(data.iban ?? "")
    setBic(data.bic ?? "")
    setDirty(false)
  }, [data])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/bank", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ website, iban, bic }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json() as Promise<BankData>
    },
    onSuccess: (saved) => {
      setWebsite(saved.website ?? "")
      setIban(saved.iban ?? "")
      setBic(saved.bic ?? "")
      qc.invalidateQueries({ queryKey: ["association"] })
      toast.success("Coordonnées mises à jour")
      setDirty(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const hasPreview = !!(website || iban || bic)

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Site web &amp; coordonnées bancaires</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Affichés sur les devis et factures — le RIB uniquement sur les factures, jamais sur
          un devis ou un reçu déjà payé.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Site web</Label>
          <Input
            disabled={!canEdit}
            value={website}
            onChange={e => { setWebsite(e.target.value); setDirty(true) }}
            placeholder="mon-association.fr"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">IBAN</Label>
            <Input
              disabled={!canEdit}
              value={iban}
              onChange={e => { setIban(e.target.value); setDirty(true) }}
              placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">BIC</Label>
            <Input
              disabled={!canEdit}
              value={bic}
              onChange={e => { setBic(e.target.value); setDirty(true) }}
              placeholder="AGRIFRPP"
              className="font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {hasPreview && (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1.5">
          <p className="font-medium text-muted-foreground">Aperçu sur le document</p>
          {website && <p className="text-muted-foreground">{website}</p>}
          {(iban || bic) && (
            <div className="pt-1 space-y-0.5">
              <p className="font-medium">Coordonnées bancaires</p>
              {iban && <p className="text-muted-foreground">IBAN : {iban}</p>}
              {bic  && <p className="text-muted-foreground">BIC : {bic}</p>}
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <Button size="sm" disabled={!dirty} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Enregistrer
        </Button>
      )}
    </div>
  )
}
