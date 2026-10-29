import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { FinanceCategoryInput, FinanceCategoryUpdateInput } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["finance-categories"]

async function fetchCategories(type?: string, includeArchived?: boolean) {
  const params = new URLSearchParams()
  if (type) params.set("type", type)
  if (includeArchived) params.set("includeArchived", "true")
  const query = params.toString()
  const res = await fetch(`/api/finances/categories${query ? `?${query}` : ""}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function createCategory(data: FinanceCategoryInput) {
  const res = await fetch("/api/finances/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateCategory(id: string, data: FinanceCategoryUpdateInput) {
  const res = await fetch(`/api/finances/categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

// A category with history is archived instead of deleted (see DELETE /api/finances/categories/[id])
// — the route still answers 200 with the archived row in that case, 204 on a real hard delete.
// Callers use the returned flag to pick the right toast copy.
async function deleteCategory(id: string): Promise<{ archived: boolean }> {
  const res = await fetch(`/api/finances/categories/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
  return { archived: res.status === 200 }
}

async function reactivateCategory(id: string) {
  const res = await fetch(`/api/finances/categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reactivate: true }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la réactivation"))
  return res.json()
}

async function seedCategories() {
  const res = await fetch("/api/finances/categories/seed", { method: "POST" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: QK })
}

export function useFinanceCategories(type?: string, includeArchived?: boolean) {
  return useQuery({
    queryKey:  [...QK, type, includeArchived ?? false],
    queryFn:   () => fetchCategories(type, includeArchived),
    staleTime: 60_000,
  })
}

export function useCreateFinanceCategory() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createCategory, onSuccess: () => invalidateAll(qc) })
}

export function useUpdateFinanceCategory(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: FinanceCategoryUpdateInput) => updateCategory(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteFinanceCategory() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteCategory, onSuccess: () => invalidateAll(qc) })
}

export function useReactivateFinanceCategory() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: reactivateCategory, onSuccess: () => invalidateAll(qc) })
}

export function useSeedFinanceCategories() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: seedCategories, onSuccess: () => invalidateAll(qc) })
}
