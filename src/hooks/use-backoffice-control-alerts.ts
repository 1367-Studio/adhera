import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"
import type { PaginatedResult } from "@/lib/pagination"

export type ControlAlertStatus = "OUVERT" | "RESOLU"

export type BackofficeControlAlert = {
  id:            string
  membreId:      string
  associationId: string
  status:        ControlAlertStatus
  raisedAt:      string
  resolvedAt:    string | null
  autoResolved:  boolean
  note:          string | null
  membre:        { firstName: string; lastName: string; email: string | null; createdAt: string }
  association:   { name: string; slug: string }
}

const QK = ["backoffice", "control-alerts"]

type ListParams = { status?: ControlAlertStatus; page?: number; limit?: number; search?: string }

async function fetchControlAlerts(params: ListParams): Promise<PaginatedResult<BackofficeControlAlert>> {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set("status", params.status)
  if (params.page)   searchParams.set("page", String(params.page))
  if (params.limit)  searchParams.set("limit", String(params.limit))
  if (params.search) searchParams.set("search", params.search)
  const res = await fetch(`/api/backoffice/control-alerts?${searchParams}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
  return res.json()
}

async function setControlAlertStatus(id: string, status: ControlAlertStatus, note?: string): Promise<BackofficeControlAlert> {
  const res = await fetch(`/api/backoffice/control-alerts/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ status, note }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

async function resolveManyControlAlerts(ids: string[], note?: string): Promise<{ resolved: number }> {
  const res = await fetch("/api/backoffice/control-alerts", {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ids, note }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

// Used standalone (no page/search) by the sidebar badge — it only ever needs the OUVERT
// count, so page 1 at a small limit is enough without a second "count-only" endpoint.
export function useBackofficeControlAlerts(params: ListParams = {}) {
  return useQuery({
    queryKey:  [...QK, params.status ?? "all", params.page ?? 1, params.limit ?? 20, params.search ?? ""],
    queryFn:   () => fetchControlAlerts(params),
    staleTime: 0,
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: QK })
}

export function useResolveBackofficeControlAlert(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (note?: string) => setControlAlertStatus(id, "RESOLU", note),
    onSuccess:  () => invalidate(qc),
  })
}

export function useReopenBackofficeControlAlert(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => setControlAlertStatus(id, "OUVERT"),
    onSuccess:  () => invalidate(qc),
  })
}

export function useResolveManyBackofficeControlAlerts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, note }: { ids: string[]; note?: string }) => resolveManyControlAlerts(ids, note),
    onSuccess:  () => invalidate(qc),
  })
}
