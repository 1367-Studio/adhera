import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { FinanceCategoryInput, FinanceCategoryUpdateInput } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["finance-categories"]

async function fetchCategories(type?: string) {
  const params = type ? `?type=${type}` : ""
  const res = await fetch(`/api/finances/categories${params}`)
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

async function deleteCategory(id: string) {
  const res = await fetch(`/api/finances/categories/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

async function seedCategories() {
  const res = await fetch("/api/finances/categories/seed", { method: "POST" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: QK })
}

export function useFinanceCategories(type?: string) {
  return useQuery({
    queryKey:  [...QK, type],
    queryFn:   () => fetchCategories(type),
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

export function useSeedFinanceCategories() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: seedCategories, onSuccess: () => invalidateAll(qc) })
}
