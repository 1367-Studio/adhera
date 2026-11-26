import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { TacheInput, TacheUpdateInput, TacheCategorieInput } from "@/lib/schemas"
import type { TacheFilters } from "@/lib/tache-query"

export type TacheStatus = "A_FAIRE" | "EN_COURS" | "TERMINEE"
export type TacheReminderDirection = "AVANT" | "APRES"

export type TacheMembre = { id: string; firstName: string; lastName: string }
export type TacheCategorie = { id: string; nom: string }
export type TacheReminder = { id: string; offsetDays: number; direction: TacheReminderDirection }
export type TacheAssignee = { id: string; membreId: string; membre: TacheMembre }

export type Tache = {
  id:                   string
  titre:                string
  description:          string | null
  categorieId:          string | null
  categorie:            TacheCategorie | null
  dueDate:              string | null
  status:               TacheStatus
  completedAt:          string | null
  completedByMembreId:  string | null
  completedBy:          TacheMembre | null
  linkBackHref:         string | null
  linkBackLabel:        string | null
  createdAt:            string
  assignees:            TacheAssignee[]
  reminders:            TacheReminder[]
}

export type TachesPaginatedResult = { data: Tache[]; total: number; page: number; limit: number; totalPages: number }

export type TacheSummary = { aFaire: number; enCours: number; echeanceSous7Jours: number; enRetard: number }

const KEY = ["taches"]
const detailKey = (id: string) => ["taches", id]
const categoriesKey = ["taches", "categories"]

function invalidateAll(qc: ReturnType<typeof useQueryClient>, id?: string) {
  const ops = [
    qc.invalidateQueries({ queryKey: KEY }),
    qc.invalidateQueries({ queryKey: ["portal-taches"] }),
    qc.invalidateQueries({ queryKey: ["dashboard"] }),
  ]
  if (id) ops.push(qc.invalidateQueries({ queryKey: detailKey(id) }))
  return Promise.all(ops)
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? "Erreur")
  }
  return res.status === 204 ? null : res.json()
}

function filtersToQuery(filters?: TacheFilters): string {
  const p = new URLSearchParams()
  if (filters?.membreId)    p.set("membreId", filters.membreId)
  if (filters?.categorieId) p.set("categorieId", filters.categorieId)
  if (filters?.status)      p.set("status", filters.status)
  if (filters?.dueFilter)   p.set("dueFilter", filters.dueFilter)
  if (filters?.dueBefore)   p.set("dueBefore", filters.dueBefore)
  if (filters?.dueAfter)    p.set("dueAfter", filters.dueAfter)
  if (filters?.search)      p.set("search", filters.search)
  return p.toString()
}

export function useTaches(filters?: TacheFilters) {
  const qs = filtersToQuery(filters)
  return useQuery<Tache[]>({
    queryKey: [...KEY, filters ?? {}],
    queryFn:  () => fetchJson(qs ? `/api/taches?${qs}` : "/api/taches"),
  })
}

export function useTachesPaginated(page: number, limit: number, filters?: TacheFilters) {
  const qs = filtersToQuery(filters)
  return useQuery<TachesPaginatedResult>({
    queryKey: [...KEY, "paginated", page, limit, filters ?? {}],
    queryFn:  () => fetchJson(`/api/taches?page=${page}&limit=${limit}${qs ? `&${qs}` : ""}`),
  })
}

// Cards de résumé au-dessus de la liste (FORM-118, commentaire Emmanuelle) — refetch à chaque
// changement de membreId, pour que les quatre compteurs retombent sur les totaux association
// quand le filtre "Membre" est vidé.
export function useTacheSummary(membreId?: string) {
  return useQuery<TacheSummary>({
    queryKey: [...KEY, "summary", membreId ?? null],
    queryFn:  () => fetchJson(membreId ? `/api/taches/summary?membreId=${encodeURIComponent(membreId)}` : "/api/taches/summary"),
  })
}

export function useTachesByMonth(year: number, month: number) {
  const from = new Date(year, month, 1).toISOString()
  const to   = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString()
  return useQuery<Tache[]>({
    queryKey: [...KEY, "calendar", year, month],
    queryFn:  () => fetchJson(`/api/taches?dueAfter=${encodeURIComponent(from)}&dueBefore=${encodeURIComponent(to)}`),
    staleTime: 0,
  })
}

export function useTache(id: string | null) {
  return useQuery<Tache>({
    queryKey: detailKey(id ?? ""),
    queryFn:  () => fetchJson(`/api/taches/${id}`),
    enabled:  !!id,
  })
}

export function useCreateTache() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TacheInput) => fetchJson("/api/taches", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateTache(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TacheUpdateInput) => fetchJson(`/api/taches/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
    onSuccess: () => invalidateAll(qc, id),
  })
}

export function useDeleteTache() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/api/taches/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useCompleteTache() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/api/taches/${id}/complete`, { method: "POST" }),
    onSuccess: (_data, id) => invalidateAll(qc, id),
  })
}

export function useTacheCategories() {
  return useQuery<TacheCategorie[]>({
    queryKey: categoriesKey,
    queryFn:  () => fetchJson("/api/taches/categories"),
  })
}

export function useCreateTacheCategorie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TacheCategorieInput) => fetchJson("/api/taches/categories", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: categoriesKey }),
  })
}

export function useRenameTacheCategorie(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TacheCategorieInput) => fetchJson(`/api/taches/categories/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
    onSuccess: () => invalidateAll(qc),
  })
}

const PORTAL_KEY = ["portal-taches"]

export function usePortalTaches() {
  return useQuery<Tache[]>({
    queryKey: PORTAL_KEY,
    queryFn:  () => fetchJson("/api/portal/taches"),
  })
}

export function useUpdatePortalTacheStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "A_FAIRE" | "EN_COURS" }) => fetchJson(`/api/portal/taches/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PORTAL_KEY }),
  })
}

export function useCompletePortalTache() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/api/portal/taches/${id}/complete`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PORTAL_KEY }),
  })
}

export function useArchiveTacheCategorie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/api/taches/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: categoriesKey }),
  })
}
