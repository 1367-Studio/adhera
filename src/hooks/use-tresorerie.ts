import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { TresorerieInput, TresorerieUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["tresorerie"]

type TresorerieResult = PaginatedResult<unknown> & { solde: number }

type Filters = { type?: string; year?: number; search?: string }

async function fetchTresorerie(page: number, limit: number, filters: Filters) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.type)   params.set("type",   filters.type)
  if (filters.year)   params.set("year",   String(filters.year))
  if (filters.search) params.set("search", filters.search)
  const res = await fetch(`/api/tresorerie?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json() as Promise<TresorerieResult>
}

async function createEntry(data: TresorerieInput) {
  const res = await fetch("/api/tresorerie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateEntry(id: string, data: TresorerieUpdateInput) {
  const res = await fetch(`/api/tresorerie/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteEntry(id: string) {
  const res = await fetch(`/api/tresorerie/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

export function useTresorerie(page: number, limit = 25, filters: Filters = {}) {
  return useQuery({
    queryKey: [...QK, page, limit, filters],
    queryFn:  () => fetchTresorerie(page, limit, filters),
  })
}

export function useCreateEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createEntry,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useUpdateEntry(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TresorerieUpdateInput) => updateEntry(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useDeleteEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteEntry,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}
