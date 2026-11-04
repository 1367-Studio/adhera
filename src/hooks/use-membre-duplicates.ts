import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"
import type { PaginatedResult } from "@/lib/pagination"
import type {
  MembreDuplicateMatchListItem, MembreDuplicateDetail, MembreDuplicateMergeResponse,
} from "@/lib/schemas"
import type { FieldResolutions } from "@/lib/membre-merge-fields"

export type MembreDuplicateStatusFilter = "PENDING" | "DISMISSED" | "MERGED" | "all"

type ListParams = { status?: MembreDuplicateStatusFilter; page?: number; limit?: number; search?: string }

// Used by both /dashboard/membres/duplicates (basePath "/api/membres/duplicates") and
// /backoffice/membre-duplicates (basePath "/api/backoffice/membre-duplicates") — the two
// APIs return the same shape, backoffice rows just carry an extra associationName.

export function useMembreDuplicates(basePath: string, params: ListParams = {}) {
  return useQuery({
    queryKey: [basePath, "list", params.status ?? "PENDING", params.page ?? 1, params.limit ?? 20, params.search ?? ""],
    queryFn: async (): Promise<PaginatedResult<MembreDuplicateMatchListItem & { associationName?: string }>> => {
      const searchParams = new URLSearchParams()
      if (params.status && params.status !== "all") searchParams.set("status", params.status)
      if (params.page)   searchParams.set("page", String(params.page))
      if (params.limit)  searchParams.set("limit", String(params.limit))
      if (params.search) searchParams.set("search", params.search)
      const res = await fetch(`${basePath}?${searchParams}`)
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
      return res.json()
    },
    staleTime: 0,
  })
}

export function useMembreDuplicateDetail(basePath: string, id: string | null) {
  return useQuery({
    queryKey: [basePath, "detail", id],
    queryFn: async (): Promise<MembreDuplicateDetail & { associationName?: string }> => {
      const res = await fetch(`${basePath}/${id}`)
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
      return res.json()
    },
    enabled: !!id,
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>, basePath: string) {
  return qc.invalidateQueries({ queryKey: [basePath] })
}

export function useScanMembreDuplicates(basePath: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body?: { associationId: string }) => {
      const res = await fetch(`${basePath}/scan`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body ?? {}),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la recherche de doublons"))
      return res.json() as Promise<{ pendingCount: number; newCount: number; autoDismissedCount: number }>
    },
    onSuccess: () => invalidate(qc, basePath),
  })
}

export function useSetMembreDuplicateStatus(basePath: string, id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (status: "PENDING" | "DISMISSED") => {
      const res = await fetch(`${basePath}/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json()
    },
    onSuccess: () => invalidate(qc, basePath),
  })
}

export function useMergeMembreDuplicate(basePath: string, id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { primaryMembreId: string; fieldResolutions: FieldResolutions }): Promise<MembreDuplicateMergeResponse> => {
      const res = await fetch(`${basePath}/${id}/merge`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la fusion"))
      return res.json()
    },
    onSuccess: () => invalidate(qc, basePath),
  })
}

// Backs the backoffice association picker only.
export function useBackofficeAssociationSearch(search: string) {
  return useQuery({
    queryKey: ["backoffice", "membre-duplicates", "associations", search],
    queryFn: async (): Promise<{ data: { id: string; name: string; slug: string }[] }> => {
      const searchParams = new URLSearchParams()
      if (search) searchParams.set("search", search)
      const res = await fetch(`/api/backoffice/membre-duplicates/associations?${searchParams}`)
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json()
    },
  })
}
