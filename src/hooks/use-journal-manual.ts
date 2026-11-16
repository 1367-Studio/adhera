import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"

export type ChartAccountOption = {
  id:     string
  code:   string
  label:  string
  nature: "ACTIF" | "PASSIF" | "CHARGE" | "PRODUIT"
}

export type ManualJournalLineInput = {
  chartAccountId: string
  debit?:  number
  credit?: number
}

export type ManualJournalEntryInput = {
  exerciceId: string
  date:       string
  label:      string
  lines:      ManualJournalLineInput[]
}

async function fetchChartAccounts(): Promise<ChartAccountOption[]> {
  const res = await fetch("/api/finances/journal/comptes")
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function createManualEntry(data: ManualJournalEntryInput) {
  const res = await fetch("/api/finances/journal/manual", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

export function useChartAccounts() {
  return useQuery({ queryKey: ["chart-accounts"], queryFn: fetchChartAccounts, staleTime: 60_000 })
}

export function useCreateManualJournalEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createManualEntry,
    // Invalide tout ce qui lit le journal — le Bilan (toutes les rubriques, pas seulement
    // celle visée) et le drill-down, qui réutilise la même clé que la tela.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bilan"] })
      qc.invalidateQueries({ queryKey: ["bilan-lignes"] })
    },
  })
}
