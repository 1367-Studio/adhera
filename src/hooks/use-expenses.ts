import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ExpenseInput, ExpenseUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["expenses"]

type Filters = {
  status?:     string
  categoryId?: string
  vendor?:     string
  dateFrom?:   string
  dateTo?:     string
}

async function fetchExpenses(page: number, limit: number, filters: Filters) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.status)     params.set("status",     filters.status)
  if (filters.categoryId) params.set("categoryId", filters.categoryId)
  if (filters.vendor)     params.set("vendor",     filters.vendor)
  if (filters.dateFrom)   params.set("dateFrom",   filters.dateFrom)
  if (filters.dateTo)     params.set("dateTo",     filters.dateTo)
  const res = await fetch(`/api/finances/expenses?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function createExpense(data: ExpenseInput) {
  const res = await fetch("/api/finances/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateExpense(id: string, data: ExpenseUpdateInput) {
  const res = await fetch(`/api/finances/expenses/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteExpense(id: string) {
  const res = await fetch(`/api/finances/expenses/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["bank-transactions"] }),
    qc.invalidateQueries({ queryKey: ["finances-stats"] }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useExpenses(page: number, limit = 25, filters: Filters = {}) {
  return useQuery({
    queryKey:  [...QK, page, limit, filters],
    queryFn:   () => fetchExpenses(page, limit, filters),
    staleTime: 0,
  })
}

export function useCreateExpense() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createExpense, onSuccess: () => invalidateAll(qc) })
}

export function useUpdateExpense(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ExpenseUpdateInput) => updateExpense(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteExpense() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteExpense, onSuccess: () => invalidateAll(qc) })
}
