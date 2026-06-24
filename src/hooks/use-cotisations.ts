import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { CotisationInput, CotisationUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["cotisations"]

type Filters = { year?: number; status?: string; search?: string }

async function fetchCotisationsPaginated(page: number, limit: number, filters: Filters) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.year)   params.set("year",   String(filters.year))
  if (filters.status) params.set("status", filters.status)
  if (filters.search) params.set("search", filters.search)
  const res = await fetch(`/api/cotisations?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des cotisations")
  return res.json() as Promise<PaginatedResult<unknown> & { totalPaye: number }>
}

async function createCotisation(data: CotisationInput) {
  const res = await fetch("/api/cotisations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateCotisation(id: string, data: CotisationUpdateInput) {
  const res = await fetch(`/api/cotisations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteCotisation(id: string) {
  const res = await fetch(`/api/cotisations/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

export function useCotisationsPaginated(page: number, limit = 20, filters: Filters = {}) {
  return useQuery({
    queryKey: [...QK, "paginated", page, limit, filters],
    queryFn:  () => fetchCotisationsPaginated(page, limit, filters),
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["portal-cotisation"] }),
    qc.invalidateQueries({ queryKey: ["dashboard"] }),
  ])
}

export function useCreateCotisation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createCotisation,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateCotisation(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CotisationUpdateInput) => updateCotisation(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteCotisation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteCotisation,
    onSuccess: () => invalidateAll(qc),
  })
}
