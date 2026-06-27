import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ActualiteInput, ActualiteUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["actualites"]

async function fetchActualitesPaginated(page: number, limit: number, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) params.set("search", search)
  const res = await fetch(`/api/actualites?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des actualités")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function createActualite(data: ActualiteInput) {
  const res = await fetch("/api/actualites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateActualite(id: string, data: ActualiteUpdateInput) {
  const res = await fetch(`/api/actualites/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteActualite(id: string) {
  const res = await fetch(`/api/actualites/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

export function useActualitesPaginated(page: number, limit = 20, search?: string) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, search],
    queryFn:   () => fetchActualitesPaginated(page, limit, search),
    staleTime: 0,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["portal-actualites"] }),
    qc.invalidateQueries({ queryKey: ["portal-actualite"] }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useCreateActualite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createActualite,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateActualite(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ActualiteUpdateInput) => updateActualite(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteActualite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteActualite,
    onSuccess: () => invalidateAll(qc),
  })
}
