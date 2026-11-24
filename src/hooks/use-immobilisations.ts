import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ImmobilisationInput, ImmobilisationUpdateInput } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"

const QK            = ["immobilisations"]
const ELIGIBLE_QK    = ["immobilisations", "eligible-expenses"]

async function fetchImmobilisations() {
  const res = await fetch("/api/finances/immobilisations")
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function fetchEligibleExpenses() {
  const res = await fetch("/api/finances/immobilisations/eligible-expenses")
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function createImmobilisation(data: ImmobilisationInput) {
  const res = await fetch("/api/finances/immobilisations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateImmobilisation(id: string, data: ImmobilisationUpdateInput) {
  const res = await fetch(`/api/finances/immobilisations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteImmobilisation(id: string) {
  const res = await fetch(`/api/finances/immobilisations/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ELIGIBLE_QK }),
  ])
}

export function useImmobilisations() {
  return useQuery({ queryKey: QK, queryFn: fetchImmobilisations, staleTime: 0 })
}

export function useEligibleExpensesForImmobilisation() {
  return useQuery({ queryKey: ELIGIBLE_QK, queryFn: fetchEligibleExpenses, staleTime: 0 })
}

export function useCreateImmobilisation() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createImmobilisation, onSuccess: () => invalidateAll(qc) })
}

export function useUpdateImmobilisation(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ImmobilisationUpdateInput) => updateImmobilisation(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteImmobilisation() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteImmobilisation, onSuccess: () => invalidateAll(qc) })
}
