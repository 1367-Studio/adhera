import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { CotisationInput, CotisationUpdateInput, CotisationPaymentInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage, apiError } from "@/lib/api-error"

const QK = ["cotisations"]

export type RenewalMode = "AUTO" | "MANUAL"
type Filters = { year?: number; status?: string; search?: string; tierId?: string; renewalMode?: RenewalMode }

export type CotisationsSummary = { count: number; aPagar: number; recebido: number; saldo: number }

function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.year)        params.set("year",        String(filters.year))
  if (filters.status)      params.set("status",      filters.status)
  if (filters.search)      params.set("search",      filters.search)
  if (filters.tierId)      params.set("tierId",      filters.tierId)
  if (filters.renewalMode) params.set("renewalMode", filters.renewalMode)
  return params
}

async function fetchCotisationsPaginated(page: number, limit: number, filters: Filters) {
  const params = filtersToParams(filters)
  params.set("page",  String(page))
  params.set("limit", String(limit))
  const res = await fetch(`/api/cotisations?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des cotisations")
  return res.json() as Promise<PaginatedResult<unknown> & { summary: CotisationsSummary }>
}

export type DistributionGroup = {
  tierId:      string | null
  tierLabel:   string | null
  renewalMode: RenewalMode
  count:       number
  aPagar:      number
  recebido:    number
  saldo:       number
}

async function fetchCotisationsDistribution(filters: Filters) {
  const res = await fetch(`/api/cotisations/distribution?${filtersToParams(filters)}`)
  if (!res.ok) throw new Error("Erreur lors du chargement de la répartition")
  return res.json() as Promise<{ groups: DistributionGroup[]; total: CotisationsSummary }>
}

export type CotisationTierOption = { id: string; label: string }

async function fetchCotisationTierOptions() {
  const res = await fetch("/api/cotisations/tier-options")
  if (!res.ok) return { tiers: [] as CotisationTierOption[], hasUncategorized: false }
  const data = await res.json()
  return { tiers: data.tiers as CotisationTierOption[], hasUncategorized: !!data.hasUncategorized }
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

// Only fetched while "Voir la répartition" is expanded — the breakdown isn't needed on first
// paint, and refetching it on every filter change while collapsed would be wasted work.
export function useCotisationsDistribution(filters: Filters, enabled: boolean) {
  return useQuery({
    queryKey:  [...QK, "distribution", filters],
    queryFn:   () => fetchCotisationsDistribution(filters),
    enabled,
    staleTime: 0,
  })
}

export function useCotisationTierOptions() {
  return useQuery({
    queryKey: [...QK, "tier-options"],
    queryFn:  fetchCotisationTierOptions,
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

export type DuplicateTierCandidate = {
  id:                      string
  label:                   string
  formId:                  string
  formTitle:               string
  kind:                    "ONE_OFF" | "RECURRING"
  amount:                  string | null
  free:                    boolean
  freeAmount:              boolean
  cotisationCount:         number
  membreCount:             number
  subscriptionCount:       number
  activeSubscriptionCount: number
}
export type DuplicateTierGroup = { normalizedLabel: string; tiers: DuplicateTierCandidate[] }

async function fetchMembershipTierDuplicates() {
  const res = await fetch("/api/membership-tiers/duplicates")
  if (!res.ok) throw new Error("Erreur lors de la recherche de doublons")
  const data = await res.json()
  return data.groups as DuplicateTierGroup[]
}

// Only fetched when the "Fusionner les catégories en double" entry is opened — scanning every
// tier's label on every page load would be wasted work for the common case of no duplicates.
export function useMembershipTierDuplicates(enabled: boolean) {
  return useQuery({
    queryKey: [...QK, "tier-duplicates"],
    queryFn:  fetchMembershipTierDuplicates,
    enabled,
  })
}

async function mergeMembershipTiers(primaryTierId: string, secondaryTierId: string) {
  const res = await fetch("/api/membership-tiers/duplicates/merge", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ primaryTierId, secondaryTierId }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la fusion"))
  return res.json()
}

export function useMergeMembershipTiers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ primaryTierId, secondaryTierId }: { primaryTierId: string; secondaryTierId: string }) =>
      mergeMembershipTiers(primaryTierId, secondaryTierId),
    onSuccess: () => Promise.all([
      invalidateAll(qc),
      qc.invalidateQueries({ queryKey: ["membership-form"] }),
    ]),
  })
}
