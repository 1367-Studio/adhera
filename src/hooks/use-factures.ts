import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { FactureCreateInput, FactureUpdateInput, FacturePaymentInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiError, apiErrorMessage } from "@/lib/api-error"

const QK = ["factures"]

async function fetchFacturesPaginated(page: number, limit: number, search?: string, status?: string, fournisseurId?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) params.set("search", search)
  if (status) params.set("status", status)
  if (fournisseurId) params.set("fournisseurId", fournisseurId)
  const res = await fetch(`/api/factures?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des factures")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function fetchFactureDetail(id: string) {
  const res = await fetch(`/api/factures/${id}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement de la facture"))
  return res.json()
}

async function createFacture(data: FactureCreateInput) {
  const res = await fetch("/api/factures", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateFacture(id: string, data: FactureUpdateInput, force?: boolean) {
  const res = await fetch(`/api/factures/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ...data, force: !!force }),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

async function deleteFacture(id: string, force?: boolean) {
  const res = await fetch(`/api/factures/${id}`, {
    method:  "DELETE",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ force: !!force }),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

async function duplicateFacture(id: string) {
  const res = await fetch(`/api/factures/${id}/duplicate`, { method: "POST" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la duplication")
  return res.json()
}

async function sendFactureEmail(id: string, to: string, message: string) {
  const res = await fetch(`/api/factures/${id}/send-email`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ to, message }),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de l'envoi de l'e-mail")
  return res.json()
}

async function addPayment(id: string, data: FacturePaymentInput) {
  const res = await fetch(`/api/factures/${id}/paiements`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de l'enregistrement du paiement")
  return res.json()
}

async function removePayment(id: string, paymentId: string) {
  const res = await fetch(`/api/factures/${id}/paiements/${paymentId}`, { method: "DELETE" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression du paiement")
  return res.json()
}

export function useFacturesPaginated(page: number, limit = 20, search?: string, status?: string, fournisseurId?: string) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, search, status, fournisseurId],
    queryFn:   () => fetchFacturesPaginated(page, limit, search, status, fournisseurId),
    staleTime: 0,
  })
}

export function useFactureDetail(id: string) {
  return useQuery({
    queryKey: [...QK, "detail", id],
    queryFn:  () => fetchFactureDetail(id),
    enabled:  !!id,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
    qc.invalidateQueries({ queryKey: ["devis"] }),
    // Payments are aggregated per-fournisseur in the "Paiements" tab of the fournisseur
    // detail page — a payment added/removed here must refresh that view too.
    qc.invalidateQueries({ queryKey: ["fournisseurs"] }),
  ])
}

export function useCreateFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createFacture,
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useUpdateFacture(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ data, force }: { data: FactureUpdateInput; force?: boolean }) => updateFacture(id, data, force),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDeleteFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => deleteFacture(id, force),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDuplicateFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: duplicateFacture,
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useSendFactureEmail(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ to, message }: { to: string; message: string }) => sendFactureEmail(id, to, message),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useAddFacturePayment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: FacturePaymentInput) => addPayment(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useRemoveFacturePayment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) => removePayment(id, paymentId),
    onSuccess:  () => invalidateAll(qc),
  })
}
