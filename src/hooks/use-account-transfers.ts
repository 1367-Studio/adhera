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
