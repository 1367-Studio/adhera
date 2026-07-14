import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { FournisseurCreateInput, FournisseurUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["fournisseurs"]

export type FournisseurRef = { id: string; companyName: string; status: "ACTIF" | "INACTIF" | "ARCHIVE"; deletedAt: string | null }

// Deliberately not filtered to ?status=ACTIF — a Devis/Facture already linked to a
// fournisseur that's since gone INACTIF/ARCHIVE must still show it as selected when
// editing, otherwise the dropdown looks like the link silently vanished. Non-active
// suppliers are still fetched, just sorted after and labeled in the UI (see
// devis-form.tsx / facture-form.tsx). `includeId` additionally surfaces a fournisseur
// that's been archived (soft-deleted) — normally excluded entirely — when it's the id
// currently selected on the document being edited, for the same reason.
async function fetchFournisseursList(includeId?: string): Promise<FournisseurRef[]> {
  const params = includeId ? `?includeId=${includeId}` : ""
  const res = await fetch(`/api/fournisseurs${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des fournisseurs")
  return res.json()
}

export function useFournisseursList(includeId?: string, enabled = true) {
  return useQuery({ queryKey: [...QK, "list", includeId], queryFn: () => fetchFournisseursList(includeId), staleTime: 30_000, enabled })
}

async function fetchFournisseursPaginated(page: number, limit: number, search?: string, status?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) params.set("search", search)
  if (status) params.set("status", status)
  const res = await fetch(`/api/fournisseurs?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des fournisseurs")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function fetchFournisseur(id: string) {
  const res = await fetch(`/api/fournisseurs/${id}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement du fournisseur"))
  return res.json()
}

export type FournisseurPayment = {
  id:      string
  amount:  string
  method:  string
  paidAt:  string
  note:    string | null
  facture: { id: string; number: string }
}

async function fetchFournisseurPaiements(id: string): Promise<FournisseurPayment[]> {
  const res = await fetch(`/api/fournisseurs/${id}/paiements`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement des paiements"))
  return res.json()
}

export function useFournisseurPaiements(id: string) {
  return useQuery({
    queryKey: [...QK, "paiements", id],
    queryFn:  () => fetchFournisseurPaiements(id),
    enabled:  !!id,
  })
}

async function createFournisseur(data: FournisseurCreateInput) {
  const res = await fetch("/api/fournisseurs", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateFournisseur(id: string, data: FournisseurUpdateInput) {
  const res = await fetch(`/api/fournisseurs/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteFournisseur(id: string) {
  const res = await fetch(`/api/fournisseurs/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

export function useFournisseursPaginated(page: number, limit = 20, search?: string, status?: string) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, search, status],
    queryFn:   () => fetchFournisseursPaginated(page, limit, search, status),
    staleTime: 0,
  })
}

export function useFournisseur(id: string) {
  return useQuery({
    queryKey: [...QK, "detail", id],
    queryFn:  () => fetchFournisseur(id),
    enabled:  !!id,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useCreateFournisseur() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createFournisseur,
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useUpdateFournisseur(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: FournisseurUpdateInput) => updateFournisseur(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDeleteFournisseur() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteFournisseur,
    onSuccess:  () => invalidateAll(qc),
  })
}
