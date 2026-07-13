"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useAddFacturePayment } from "@/hooks/use-factures"
import { Modal } from "@/components/ui/modal"
import { CurrencyField } from "@/components/ui/currency-field"
import { SelectField } from "@/components/ui/select-field"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"

const methodOptions = [
  { value: "Virement",    label: "Virement"     },
  { value: "Espèces",     label: "Espèces"      },
  { value: "Chèque",      label: "Chèque"       },
  { value: "Carte",       label: "Carte"        },
  { value: "Prélèvement", label: "Prélèvement"  },
  { value: "Autre",       label: "Autre"        },
]

interface Props {
  factureId: string
  remaining: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FacturePaymentModal({ factureId, remaining, open, onOpenChange }: Props) {
  const [amount, setAmount] = useState(remaining > 0 ? remaining : 0)
  const [method, setMethod] = useState("Virement")
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split("T")[0])
  const [note, setNote]     = useState("")
  const mutation = useAddFacturePayment(factureId)

  async function handleSubmit() {
    if (amount <= 0) {
      toast.error("Le montant doit être supérieur à 0")
      return
    }
    try {
      await mutation.mutateAsync({ amount, method, paidAt, note })
      toast.success("Paiement enregistré")
      onOpenChange(false)
      setNote("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Enregistrer un paiement" size="sm">
      <div className="space-y-4">
        <CurrencyField label="Montant" required value={amount} onChange={setAmount} />
        <SelectField label="Méthode" required options={methodOptions} value={method} onValueChange={setMethod} />
        <FormField label="Date du paiement" type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
        <FormField label="Note" placeholder="Référence, remarque…" value={note} onChange={e => setNote(e.target.value)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Annuler
          </Button>
          <Button type="button" onClick={handleSubmit} loading={mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Modal>
  )
}
