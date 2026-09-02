import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { EvenementInput, EvenementUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage } from "@/lib/api-error"

const QK = ["evenements"]

async function fetchEvenementsPaginated(page: number, limit: number, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) params.set("search", search)
  const res = await fetch(`/api/evenements?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des événements")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function fetchEvenement(id: string) {
  const res = await fetch(`/api/evenements/${id}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function fetchParticipations(evenementId: string) {
  const res = await fetch(`/api/evenements/${evenementId}/participations`)
  if (!res.ok) throw new Error("Erreur lors du chargement des présences")
  return res.json()
}

async function createEvenement(data: EvenementInput) {
  const res = await fetch("/api/evenements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function updateEvenement(id: string, data: EvenementUpdateInput) {
  const res = await fetch(`/api/evenements/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteEvenement(id: string) {
  const res = await fetch(`/api/evenements/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

export type GuestInput = { firstName: string; lastName: string; email?: string; ticketTypeId?: string }

async function setRsvp(evenementId: string, rsvp: string, quantity?: number, guests?: GuestInput[], ticketTypeId?: string) {
  const res = await fetch(`/api/portal/evenements/${evenementId}/rsvp`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ rsvp, ...(quantity != null && { quantity }), ...(guests != null && { guests }), ...(ticketTypeId != null && { ticketTypeId }) }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

async function submitReview(evenementId: string, rating: number, comment?: string) {
  const res = await fetch(`/api/portal/evenements/${evenementId}/avaliacao`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ rating, ...(comment && { comment }) }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

export function useSubmitReview(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rating, comment }: { rating: number; comment?: string }) =>
      submitReview(evenementId, rating, comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-evenements"] }),
  })
}

async function generateQr(evenementId: string) {
  const res = await fetch(`/api/evenements/${evenementId}/qr`, { method: "POST" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json() as Promise<{ qrToken: string; qrExpiresAt: string }>
}

async function revokeQr(evenementId: string) {
  const res = await fetch(`/api/evenements/${evenementId}/qr`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
}

// A row identifies either an existing ticket (participationId) or an active member who
// hasn't RSVP'd yet (membreId) — the backend creates the ticket on first use in that case.
export type RowRef = { participationId: string; membreId?: undefined } | { membreId: string; participationId?: undefined }

async function markPaid(evenementId: string, ref: RowRef, ticketTypeId?: string, free?: boolean) {
  const res = await fetch(`/api/evenements/${evenementId}/participations`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ...ref, ticketTypeId, free }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

async function cancelPayment(evenementId: string, ref: RowRef) {
  const res = await fetch(`/api/evenements/${evenementId}/participations/cancel-payment`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(ref),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

async function togglePresence(evenementId: string, ref: RowRef, present: boolean) {
  const res = await fetch(`/api/evenements/${evenementId}/participations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...ref, present }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

async function addGuest(evenementId: string, guest: GuestInput) {
  const res = await fetch(`/api/evenements/${evenementId}/participations/guest`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(guest),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

async function editGuest(evenementId: string, participationId: string, guest: GuestInput) {
  const res = await fetch(`/api/evenements/${evenementId}/participations/${participationId}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(guest),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

async function deleteGuest(evenementId: string, participationId: string) {
  const res = await fetch(`/api/evenements/${evenementId}/participations/${participationId}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
}

async function fetchEvenementsByMonth(year: number, month: number) {
  const from = new Date(year, month, 1).toISOString()
  const to   = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString()
  const res  = await fetch(`/api/evenements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json() as Promise<CalendarEvenement[]>
}

export type CalendarEvenement = {
  id:          string
  title:       string
  date:        string
  endDate:     string | null
  location:    string | null
  lat:         number | null
  lng:         number | null
  price:       string | null
  description: string | null
  imageUrl:    string | null
  capacity:    number | null
  adminNotificationEmail: string | null
  qrToken:     string | null
  qrExpiresAt: string | null
  ticketTypes: { id: string; label: string; price: string; remaining: number | null; full: boolean }[]
  _count:      { participations: number }
}

export function useEvenement(id: string) {
  return useQuery({
    queryKey:  [...QK, id],
    queryFn:   () => fetchEvenement(id),
    enabled:   !!id,
    staleTime: 0,
  })
}

export function useEvenementsByMonth(year: number, month: number) {
  return useQuery({
    queryKey:  [...QK, "calendar", year, month],
    queryFn:   () => fetchEvenementsByMonth(year, month),
    staleTime: 0,
  })
}

export function useEvenementsPaginated(page: number, limit = 20, search?: string) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, search],
    queryFn:   () => fetchEvenementsPaginated(page, limit, search),
    staleTime: 0,
  })
}

export function useParticipations(evenementId: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey:        [...QK, evenementId, "participations"],
    queryFn:         () => fetchParticipations(evenementId),
    enabled:         !!evenementId,
    refetchInterval: options?.refetchInterval,
    staleTime:       0,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["portal-evenements"] }),
    qc.invalidateQueries({ queryKey: ["portal-actualites"] }),
    qc.invalidateQueries({ queryKey: ["portal-actualite"] }),
    qc.invalidateQueries({ queryKey: ["dashboard"] }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useCreateEvenement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createEvenement,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateEvenement(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: EvenementUpdateInput) => updateEvenement(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteEvenement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteEvenement,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useSetRsvp(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rsvp, quantity, guests, ticketTypeId }: { rsvp: string; quantity?: number; guests?: GuestInput[]; ticketTypeId?: string }) =>
      setRsvp(evenementId, rsvp, quantity, guests, ticketTypeId),
    onSuccess:  () => Promise.all([
      qc.invalidateQueries({ queryKey: QK }),
      qc.invalidateQueries({ queryKey: ["portal-evenements"] }),
      qc.invalidateQueries({ queryKey: ["portal-actualites"] }),
      qc.invalidateQueries({ queryKey: ["portal-actualite"] }),
      qc.invalidateQueries({ queryKey: ["activity-logs"] }),
      qc.invalidateQueries({ queryKey: ["membre-logs"] }),
    ]),
    // A rejected reservation (e.g. a ticket type that just filled up) still means the
    // occupancy shown to the visitor is stale — refresh it instead of leaving them able
    // to retry the exact same dead end.
    onError: () => qc.invalidateQueries({ queryKey: ["portal-evenements"] }),
  })
}

export function useMarkPaid(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketTypeId, free, ...ref }: RowRef & { ticketTypeId?: string; free?: boolean }) => markPaid(evenementId, ref, ticketTypeId, free),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: [...QK, evenementId, "participations"] }),
      qc.invalidateQueries({ queryKey: ["activity-logs"] }),
    ]),
  })
}

export function useCancelPayment(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ref: RowRef) => cancelPayment(evenementId, ref),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: [...QK, evenementId, "participations"] }),
      qc.invalidateQueries({ queryKey: ["activity-logs"] }),
    ]),
  })
}

export function useTogglePresence(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ present, ...ref }: RowRef & { present: boolean }) =>
      togglePresence(evenementId, ref as RowRef, present),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: [...QK, evenementId, "participations"] }),
      qc.invalidateQueries({ queryKey: ["portal-evenements"] }),
      qc.invalidateQueries({ queryKey: ["dashboard"] }),
      qc.invalidateQueries({ queryKey: ["activity-logs"] }),
      qc.invalidateQueries({ queryKey: ["membre-logs"] }),
    ]),
  })
}

export function useAddGuest(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (guest: GuestInput) => addGuest(evenementId, guest),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: [...QK, evenementId, "participations"] }),
      qc.invalidateQueries({ queryKey: QK }),
      qc.invalidateQueries({ queryKey: ["activity-logs"] }),
    ]),
  })
}

export function useEditGuest(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participationId, ...guest }: GuestInput & { participationId: string }) =>
      editGuest(evenementId, participationId, guest),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, evenementId, "participations"] }),
  })
}

export function useDeleteGuest(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (participationId: string) => deleteGuest(evenementId, participationId),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: [...QK, evenementId, "participations"] }),
      qc.invalidateQueries({ queryKey: QK }),
      qc.invalidateQueries({ queryKey: ["activity-logs"] }),
    ]),
  })
}

export type EvenementCustomField = {
  id:       string
  type:     "TEXT" | "NUMBER"
  label:    string
  required: boolean
  order:    number
}
export type EvenementCustomFieldDraft = Omit<EvenementCustomField, "id" | "order"> & { id?: string }

async function fetchCustomFields(evenementId: string) {
  const res = await fetch(`/api/evenements/${evenementId}/custom-fields`)
  if (!res.ok) throw new Error("Erreur lors du chargement des champs")
  return res.json() as Promise<EvenementCustomField[]>
}

async function saveCustomFields(evenementId: string, fields: EvenementCustomFieldDraft[]) {
  const res = await fetch(`/api/evenements/${evenementId}/custom-fields`, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(fields),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json() as Promise<EvenementCustomField[]>
}

export function useEvenementCustomFields(evenementId: string) {
  return useQuery({
    queryKey: [...QK, evenementId, "custom-fields"],
    queryFn:  () => fetchCustomFields(evenementId),
    enabled:  !!evenementId,
    staleTime: 0,
  })
}

export function useSaveEvenementCustomFields(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fields: EvenementCustomFieldDraft[]) => saveCustomFields(evenementId, fields),
    onSuccess:  () => qc.invalidateQueries({ queryKey: [...QK, evenementId, "custom-fields"] }),
  })
}

export type EvenementTicketType = {
  id:       string
  label:    string
  price:    string
  capacity: number | null
  order:    number
  occupied: number
}
export type EvenementTicketTypeDraft = Omit<EvenementTicketType, "id" | "order" | "price" | "occupied"> & { id?: string; price: number }

async function fetchTicketTypes(evenementId: string) {
  const res = await fetch(`/api/evenements/${evenementId}/ticket-types`)
  if (!res.ok) throw new Error("Erreur lors du chargement des tarifs")
  return res.json() as Promise<EvenementTicketType[]>
}

async function saveTicketTypes(evenementId: string, ticketTypes: EvenementTicketTypeDraft[]) {
  const res = await fetch(`/api/evenements/${evenementId}/ticket-types`, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(ticketTypes),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json() as Promise<EvenementTicketType[]>
}

export function useEvenementTicketTypes(evenementId: string) {
  return useQuery({
    queryKey: [...QK, evenementId, "ticket-types"],
    queryFn:  () => fetchTicketTypes(evenementId),
    enabled:  !!evenementId,
    staleTime: 0,
  })
}

export function useSaveEvenementTicketTypes(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ticketTypes: EvenementTicketTypeDraft[]) => saveTicketTypes(evenementId, ticketTypes),
    onSuccess:  () => Promise.all([
      qc.invalidateQueries({ queryKey: [...QK, evenementId, "ticket-types"] }),
      qc.invalidateQueries({ queryKey: QK }),
    ]),
  })
}

export function useGenerateQr(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => generateQr(evenementId),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useRevokeQr(evenementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => revokeQr(evenementId),
    onSuccess:  () => invalidateAll(qc),
  })
}
