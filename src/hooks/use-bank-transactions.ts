import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { BankTransactionUpdateInput } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"
import type { PaginatedResult } from "@/lib/pagination"

const QK = ["bank-transactions"]

type Filters = {
  status?:        string
  bankAccountId?: string
  type?:          string
  dateFrom?:      string
  dateTo?:        string
}

async function fetchTransactions(page: number, limit: number, filters: Filters) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.status)        params.set("status",        filters.status)
  if (filters.bankAccountId) params.set("bankAccountId", filters.bankAccountId)
  if (filters.type)          params.set("type",          filters.type)
  if (filters.dateFrom)      params.set("dateFrom",      filters.dateFrom)
  if (filters.dateTo)        params.set("dateTo",        filters.dateTo)
  const res = await fetch(`/api/finances/transactions?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function updateTransaction(id: string, data: BankTransactionUpdateInput) {
  const res = await fetch(`/api/finances/transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

async function fetchSuggestions(bankTransactionId: string) {
  const res = await fetch(`/api/finances/reconcile/suggestions?bankTransactionId=${bankTransactionId}`)
  if (!res.ok) throw new Error("Erreur")
  return res.json()
}

async function reconcile(data: { bankTransactionId: string; action: "MATCH" | "IGNORE" | "DUPLICATE" | "UNMATCH"; incomeId?: string; expenseId?: string }) {
  const res = await fetch("/api/finances/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur de conciliation"))
  return res.json()
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["incomes"] }),
    qc.invalidateQueries({ queryKey: ["expenses"] }),
    qc.invalidateQueries({ queryKey: ["finances-stats"] }),
  ])
}

export function useBankTransactions(page: number, limit = 50, filters: Filters = {}) {
  return useQuery({
    queryKey:  [...QK, page, limit, filters],
    queryFn:   () => fetchTransactions(page, limit, filters),
    staleTime: 0,
  })
}

export function useUpdateTransaction(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: BankTransactionUpdateInput) => updateTransaction(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useTransactionSuggestions(bankTransactionId: string | null) {
  return useQuery({
    queryKey:  ["tx-suggestions", bankTransactionId],
    queryFn:   () => fetchSuggestions(bankTransactionId!),
    enabled:   !!bankTransactionId,
    staleTime: 30_000,
  })
}

export function useReconcile() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: reconcile, onSuccess: () => invalidateAll(qc) })
}

export function useReactivateTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => updateTransaction(id, { status: "UNMATCHED" }),
    onSuccess: () => invalidateAll(qc),
  })
}
