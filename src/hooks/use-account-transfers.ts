import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { AccountTransferInput } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["account-transfers"]

async function fetchAccountTransfers() {
  const res = await fetch("/api/finances/transfers")
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function createAccountTransfer(data: AccountTransferInput) {
  const res = await fetch("/api/finances/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateAccountTransfer(id: string, data: AccountTransferInput) {
  const res = await fetch(`/api/finances/transfers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteAccountTransfer(id: string) {
  const res = await fetch(`/api/finances/transfers/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

export function useAccountTransfers() {
  return useQuery({ queryKey: QK, queryFn: fetchAccountTransfers, staleTime: 0 })
}

export function useCreateAccountTransfer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createAccountTransfer,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

// Editing or deleting a transfer releases any BankTransaction legs matched against it (see
// the [id] route) — invalidating "bank-transactions" too keeps the Reconciliation screen's
// MATCHED/UNMATCHED badges in sync if it's open in another tab.
function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["bank-transactions"] }),
  ])
}

export function useUpdateAccountTransfer(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountTransferInput) => updateAccountTransfer(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteAccountTransfer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteAccountTransfer,
    onSuccess: () => invalidateAll(qc),
  })
}
