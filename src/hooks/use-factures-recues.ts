import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { FactureRecueCreateInput, FactureRecueUpdateInput } from "@/lib/schemas"
import { apiError } from "@/lib/api-error"

const QK = ["factures-recues"]

export type FactureRecue = {
  id:            string
  number:        string | null
  type:          "facture" | "devis_recu" | "comprovante" | "contrat" | "autre"
  issueDate:     string
  amount:        string
  status:        "A_PAYER" | "PAYEE" | "EN_LITIGE" | "ANNULEE"
  fileUrl:       string
  notes:         string | null
  fournisseurId: string | null
  fournisseur:   { id: string; companyName: string } | null
}

async function fetchFacturesRecues(fournisseurId?: string): Promise<FactureRecue[]> {
  const params = new URLSearchParams()
  if (fournisseurId) params.set("fournisseurId", fournisseurId)
  const res = await fetch(`/api/factures-recues?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des documents")
  return res.json()
}

async function createFactureRecue(data: FactureRecueCreateInput) {
  const res = await fetch("/api/factures-recues", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateFactureRecue(id: string, data: FactureRecueUpdateInput) {
  const res = await fetch(`/api/factures-recues/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

async function deleteFactureRecue(id: string) {
  const res = await fetch(`/api/factures-recues/${id}`, { method: "DELETE" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

export function useFacturesRecues(fournisseurId?: string) {
  return useQuery({
    queryKey:  [...QK, fournisseurId ?? "all"],
    queryFn:   () => fetchFacturesRecues(fournisseurId),
    staleTime: 0,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useCreateFactureRecue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createFactureRecue,
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useUpdateFactureRecue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: FactureRecueUpdateInput) => updateFactureRecue(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDeleteFactureRecue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteFactureRecue,
    onSuccess:  () => invalidateAll(qc),
  })
}
