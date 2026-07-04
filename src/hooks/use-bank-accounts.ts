import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { BankAccountInput, BankAccountUpdateInput } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["bank-accounts"]

async function fetchBankAccounts() {
  const res = await fetch("/api/finances/bank-accounts")
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function createBankAccount(data: BankAccountInput) {
  const res = await fetch("/api/finances/bank-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateBankAccount(id: string, data: BankAccountUpdateInput) {
  const res = await fetch(`/api/finances/bank-accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteBankAccount(id: string) {
  const res = await fetch(`/api/finances/bank-accounts/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: QK })
}

export function useBankAccounts() {
  return useQuery({ queryKey: QK, queryFn: fetchBankAccounts, staleTime: 0 })
}

export function useCreateBankAccount() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createBankAccount, onSuccess: () => invalidateAll(qc) })
}

export function useUpdateBankAccount(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: BankAccountUpdateInput) => updateBankAccount(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteBankAccount() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteBankAccount, onSuccess: () => invalidateAll(qc) })
}
