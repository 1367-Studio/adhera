import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { CotisationInput, CotisationUpdateInput, CotisationPaymentInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage, apiError } from "@/lib/api-error"

const QK = ["cotisations"]

type Filters = { year?: number; status?: string; search?: string }

async function fetchCotisationsPaginated(page: number, limit: number, filters: Filters) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.year)   params.set("year",   String(filters.year))
  if (filters.status) params.set("status", filters.status)
  if (filters.search) params.set("search", filters.search)
  const res = await fetch(`/api/cotisations?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des cotisations")
  return res.json() as Promise<PaginatedResult<unknown> & { totalPaye: number }>
}

async function createCotisation(data: CotisationInput) {
  const res = await fetch("/api/cotisations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  // ApiError (not a plain Error) — the CANCELLED_EXISTS case needs its `code` and the
  // existing cotisation's id (in `details`) to offer "edit it instead" in the UI.
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateCotisation(id: string, data: CotisationUpdateInput) {
  const res = await fetch(`/api/cotisations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteCotisation(id: string, force?: boolean) {
  const res = await fetch(`/api/cotisations/${id}`, {
    method:  "DELETE",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ force: !!force }),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

async function addCotisationPayment(id: string, data: CotisationPaymentInput) {
  const res = await fetch(`/api/cotisations/${id}/paiements`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de l'enregistrement du paiement"))
  return res.json()
}

async function removeCotisationPayment(id: string, paymentId: string) {
  const res = await fetch(`/api/cotisations/${id}/paiements/${paymentId}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression du paiement"))
  return res.json()
}

export function useCotisationsPaginated(page: number, limit = 20, filters: Filters = {}) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, filters],
    queryFn:   () => fetchCotisationsPaginated(page, limit, filters),
    staleTime: 0,
  })
}

// Just the fields the payment modal reads off GET /api/cotisations/[id] — amounts come back as
// Prisma Decimal strings.
export type CotisationPaymentSchedule = {
  id:           string
  amount:       string
  amountPaid:   string
  installments: { amount: string; dueDate: string }[]
}

async function fetchCotisationPaymentSchedule(id: string) {
  const res = await fetch(`/api/cotisations/${id}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement de la cotisation"))
  return res.json() as Promise<CotisationPaymentSchedule>
}

// For surfaces whose own payload doesn't carry the échéancier (the member page, the member
// card) — the payment modal loads it itself only when its caller couldn't hand it over.
// staleTime 0 like the list: a balance must never be read from a cached, pre-payment copy.
export function useCotisationPaymentSchedule(id: string, enabled: boolean) {
  return useQuery({
    queryKey:  [...QK, "detail", id],
    queryFn:   () => fetchCotisationPaymentSchedule(id),
    enabled,
    staleTime: 0,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["portal-cotisation"] }),
    qc.invalidateQueries({ queryKey: ["dashboard"] }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
    // The Membre detail view embeds a member's cotisations — without this, adding one
    // there leaves that tab showing stale data until a full page reload.
    qc.invalidateQueries({ queryKey: ["membres"] }),
  ])
}

export function useCreateCotisation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createCotisation,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateCotisation(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CotisationUpdateInput) => updateCotisation(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteCotisation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => deleteCotisation(id, force),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useAddCotisationPayment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CotisationPaymentInput) => addCotisationPayment(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useRemoveCotisationPayment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) => removeCotisationPayment(id, paymentId),
    onSuccess:  () => invalidateAll(qc),
  })
}
