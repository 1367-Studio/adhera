import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { DevisCreateInput, DevisUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiError, apiErrorMessage } from "@/lib/api-error"

const QK = ["devis"]

async function fetchDevisPaginated(page: number, limit: number, search?: string, status?: string, fournisseurId?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) params.set("search", search)
  if (status) params.set("status", status)
  if (fournisseurId) params.set("fournisseurId", fournisseurId)
  const res = await fetch(`/api/devis?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des devis")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function fetchDevisDetail(id: string) {
  const res = await fetch(`/api/devis/${id}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement du devis"))
  return res.json()
}

async function createDevis(data: DevisCreateInput) {
  const res = await fetch("/api/devis", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateDevis(id: string, data: DevisUpdateInput) {
  const res = await fetch(`/api/devis/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

async function convertDevis(id: string) {
  const res = await fetch(`/api/devis/${id}/convert`, { method: "POST" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la conversion")
  return res.json()
}

async function duplicateDevis(id: string) {
  const res = await fetch(`/api/devis/${id}/duplicate`, { method: "POST" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la duplication")
  return res.json()
}

async function sendDevisEmail(id: string, to: string, message: string) {
  const res = await fetch(`/api/devis/${id}/send-email`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ to, message }),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de l'envoi de l'e-mail")
  return res.json()
}

async function deleteDevis(id: string, force?: boolean) {
  const res = await fetch(`/api/devis/${id}`, {
    method:  "DELETE",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ force: !!force }),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

export function useDevisPaginated(page: number, limit = 20, search?: string, status?: string, fournisseurId?: string) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, search, status, fournisseurId],
    queryFn:   () => fetchDevisPaginated(page, limit, search, status, fournisseurId),
    staleTime: 0,
  })
}

export function useDevisDetail(id: string) {
  return useQuery({
    queryKey: [...QK, "detail", id],
    queryFn:  () => fetchDevisDetail(id),
    enabled:  !!id,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
    qc.invalidateQueries({ queryKey: ["factures"] }),
  ])
}

export function useCreateDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createDevis,
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useUpdateDevis(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: DevisUpdateInput) => updateDevis(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useConvertDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: convertDevis,
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDuplicateDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: duplicateDevis,
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useSendDevisEmail(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ to, message }: { to: string; message: string }) => sendDevisEmail(id, to, message),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDeleteDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => deleteDevis(id, force),
    onSuccess:  () => invalidateAll(qc),
  })
}
