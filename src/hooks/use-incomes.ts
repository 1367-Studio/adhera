import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { IncomeInput, IncomeUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["incomes"]

type Filters = {
  status?:     string
  categoryId?: string
  memberId?:   string
  dateFrom?:   string
  dateTo?:     string
}

async function fetchIncomes(page: number, limit: number, filters: Filters) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.status)     params.set("status",     filters.status)
  if (filters.categoryId) params.set("categoryId", filters.categoryId)
  if (filters.memberId)   params.set("memberId",   filters.memberId)
  if (filters.dateFrom)   params.set("dateFrom",   filters.dateFrom)
  if (filters.dateTo)     params.set("dateTo",     filters.dateTo)
  const res = await fetch(`/api/finances/incomes?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function createIncome(data: IncomeInput) {
  const res = await fetch("/api/finances/incomes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateIncome(id: string, data: IncomeUpdateInput) {
  const res = await fetch(`/api/finances/incomes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteIncome(id: string) {
  const res = await fetch(`/api/finances/incomes/${id}`, { method: "DELETE" })
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

export function useIncomes(page: number, limit = 25, filters: Filters = {}) {
  return useQuery({
    queryKey:  [...QK, page, limit, filters],
    queryFn:   () => fetchIncomes(page, limit, filters),
    staleTime: 0,
  })
}

export function useCreateIncome() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createIncome, onSuccess: () => invalidateAll(qc) })
}

export function useUpdateIncome(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: IncomeUpdateInput) => updateIncome(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteIncome() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteIncome, onSuccess: () => invalidateAll(qc) })
}
