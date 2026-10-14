import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"

export type ManualDonInput = {
  donorMode:       "member" | "external"
  membreId?:       string
  firstName?:      string
  lastName?:       string
  email?:          string
  amount:          number
  paidAt:          string
  paymentMethod:   "ESPECES" | "CHEQUE" | "VIREMENT" | "AUTRE"
  donationFormId?: string | null
  note?:           string
  sendReceiptEmail: boolean
}

async function addManualDon(data: ManualDonInput) {
  const res = await fetch("/api/dons", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de l'enregistrement du don"))
  return res.json()
}

// Invalidates the two queries a successfully recorded manual don can change: the dons
// list/totals (same key the "encaisser" flow already invalidates) and the donation-forms
// list, whose per-form totalAmount/_count only refresh via refetch, never locally.
export function useAddManualDon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: addManualDon,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-dons"] })
      qc.invalidateQueries({ queryKey: ["donation-forms"] })
    },
  })
}
