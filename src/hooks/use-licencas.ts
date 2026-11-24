import { useQuery } from "@tanstack/react-query"
import type { PaginatedResult } from "@/lib/pagination"

const QK = ["licencas"]

export type MembershipLicenseStatus = "A_SOLICITAR" | "EM_ANDAMENTO" | "VALIDADA" | "A_RENOVAR"

export type MembershipLicenseRow = {
  id: string
  federation: string
  season: string
  licenseNumber: string | null
  status: MembershipLicenseStatus
  declaredByMembre: boolean
  autoRenewed: boolean
  membre: { id: string; firstName: string; lastName: string }
  cotisation: { year: number; tier: { label: string } | null }
}

type Filters = { federation?: string; season?: string; status?: string; search?: string }

function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.federation) params.set("federation", filters.federation)
  if (filters.season)     params.set("season",     filters.season)
  if (filters.status)     params.set("status",     filters.status)
  if (filters.search)     params.set("search",     filters.search)
  return params
}

async function fetchLicencasPaginated(page: number, limit: number, filters: Filters) {
  const params = filtersToParams(filters)
  params.set("page", String(page))
  params.set("limit", String(limit))
  const res = await fetch(`/api/licencas?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des licences")
  return res.json() as Promise<PaginatedResult<MembershipLicenseRow>>
}

export function useLicencasPaginated(page: number, limit = 20, filters: Filters = {}) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, filters],
    queryFn:   () => fetchLicencasPaginated(page, limit, filters),
    staleTime: 0,
  })
}

// Narrowed by the OTHER active filters (status, and the other of federation/season) — see
// the route's own comment. Each dropdown only ever narrows itself out of its own value, so
// `federation`/`season` are deliberately not round-tripped back as their own filter here.
type FilterOptionsFilters = { federation?: string; season?: string; status?: string }

async function fetchLicencaFilterOptions(filters: FilterOptionsFilters) {
  const params = new URLSearchParams()
  if (filters.federation) params.set("federation", filters.federation)
  if (filters.season)     params.set("season",     filters.season)
  if (filters.status)     params.set("status",     filters.status)
  const res = await fetch(`/api/licencas/filter-options?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des filtres")
  return res.json() as Promise<{ federations: string[]; seasons: string[] }>
}

export function useLicencaFilterOptions(filters: FilterOptionsFilters = {}) {
  return useQuery({
    queryKey: [...QK, "filter-options", filters],
    queryFn:  () => fetchLicencaFilterOptions(filters),
  })
}
