import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type {
  ReimbursementRequestInput, ReimbursementRequestUpdateInput,
  ReimbursementItemInput, ReimbursementItemUpdateInput,
  ReimbursementApproveInput, ReimbursementCancelInput, ReimbursementRegisterInput,
} from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiError, apiErrorMessage } from "@/lib/api-error"

const QK = ["reimbursements"]

export interface ReimbursementFilters {
  requesterId?: string
  status?:      string
  categoryId?:  string
  dateFrom?:    string
  dateTo?:      string
}

function buildParams(page: number, limit: number, filters: ReimbursementFilters) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.requesterId) params.set("requesterId", filters.requesterId)
  if (filters.status)      params.set("status", filters.status)
  if (filters.categoryId)  params.set("categoryId", filters.categoryId)
  if (filters.dateFrom)    params.set("dateFrom", filters.dateFrom)
  if (filters.dateTo)      params.set("dateTo", filters.dateTo)
  return params
}

async function fetchReimbursementsPaginated(page: number, limit: number, filters: ReimbursementFilters) {
  const params = buildParams(page, limit, filters)
  const res = await fetch(`/api/finances/reimbursements?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function fetchReimbursementDetail(id: string) {
  const res = await fetch(`/api/finances/reimbursements/${id}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
  return res.json()
}

async function fetchTotals(requesterId?: string) {
  const params = requesterId ? `?requesterId=${requesterId}` : ""
  const res = await fetch(`/api/finances/reimbursements/totals${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function createRequest(data: ReimbursementRequestInput) {
  const res = await fetch("/api/finances/reimbursements", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateRequest(id: string, data: ReimbursementRequestUpdateInput) {
  const res = await fetch(`/api/finances/reimbursements/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

async function deleteRequest(id: string) {
  const res = await fetch(`/api/finances/reimbursements/${id}`, { method: "DELETE" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

async function addItem(requestId: string, data: ReimbursementItemInput) {
  const res = await fetch(`/api/finances/reimbursements/${requestId}/items`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de l'ajout de la dépense")
  return res.json()
}

async function updateItem(requestId: string, itemId: string, data: ReimbursementItemUpdateInput) {
  const res = await fetch(`/api/finances/reimbursements/${requestId}/items/${itemId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour de la dépense")
  return res.json()
}

async function deleteItem(requestId: string, itemId: string) {
  const res = await fetch(`/api/finances/reimbursements/${requestId}/items/${itemId}`, { method: "DELETE" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression de la dépense")
}

async function submitRequest(id: string) {
  const res = await fetch(`/api/finances/reimbursements/${id}/submit`, { method: "POST" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la soumission")
  return res.json()
}

async function cancelRequest(id: string, data: ReimbursementCancelInput) {
  const res = await fetch(`/api/finances/reimbursements/${id}/cancel`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de l'annulation")
  return res.json()
}

async function approveRequest(id: string, data: ReimbursementApproveInput) {
  const res = await fetch(`/api/finances/reimbursements/${id}/approve`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de l'approbation")
  return res.json()
}

async function requestCorrection(id: string, note: string) {
  const res = await fetch(`/api/finances/reimbursements/${id}/request-correction`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
  })
  if (!res.ok) throw await apiError(res, "Erreur")
  return res.json()
}

async function rejectRequest(id: string, note: string) {
  const res = await fetch(`/api/finances/reimbursements/${id}/reject`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors du refus")
  return res.json()
}

async function registerReimbursement(id: string, data: ReimbursementRegisterInput) {
  const res = await fetch(`/api/finances/reimbursements/${id}/reimbursement`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de l'enregistrement du remboursement")
  return res.json()
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useReimbursementsPaginated(page: number, limit: number, filters: ReimbursementFilters) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, filters],
    queryFn:   () => fetchReimbursementsPaginated(page, limit, filters),
    staleTime: 0,
  })
}

export function useReimbursementDetail(id: string) {
  return useQuery({
    queryKey: [...QK, "detail", id],
    queryFn:  () => fetchReimbursementDetail(id),
    enabled:  !!id,
  })
}

export function useReimbursementTotals(requesterId?: string) {
  return useQuery({ queryKey: [...QK, "totals", requesterId], queryFn: () => fetchTotals(requesterId) })
}

export function useCreateReimbursementRequest() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createRequest, onSuccess: () => invalidateAll(qc) })
}

export function useUpdateReimbursementRequest(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ReimbursementRequestUpdateInput) => updateRequest(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDeleteReimbursementRequest() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteRequest, onSuccess: () => invalidateAll(qc) })
}

export function useAddReimbursementItem(requestId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ReimbursementItemInput) => addItem(requestId, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useUpdateReimbursementItem(requestId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: ReimbursementItemUpdateInput }) => updateItem(requestId, itemId, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDeleteReimbursementItem(requestId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) => deleteItem(requestId, itemId),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useSubmitReimbursementRequest() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: submitRequest, onSuccess: () => invalidateAll(qc) })
}

export function useCancelReimbursementRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReimbursementCancelInput }) => cancelRequest(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useApproveReimbursementRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReimbursementApproveInput }) => approveRequest(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useRequestReimbursementCorrection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => requestCorrection(id, note),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useRejectReimbursementRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => rejectRequest(id, note),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useRegisterReimbursement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReimbursementRegisterInput }) => registerReimbursement(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}
