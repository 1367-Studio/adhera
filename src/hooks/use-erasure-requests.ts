import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { useTranslations } from "next-intl"
import { apiErrorMessage } from "@/lib/api-error"

type Translator = ReturnType<typeof useTranslations>

export type ErasureRequestStatus = "REVIEW" | "PENDING" | "HELD" | "PROCESSED"

export type ErasureRequest = {
  id:             string
  membreId:       string
  // Null means this was flagged automatically by the retention-sweep cron, not requested by
  // an admin or the member — see erasure-retention-sweep/route.ts.
  requestedById:  string | null
  requestedAt:    string
  processedAt:    string | null
  status:         ErasureRequestStatus
  heldReason:     string | null
  heldAt:         string | null
  heldById:       string | null
  heldFromStatus: ErasureRequestStatus | null
  retryCount:     number
  lastError:      string | null
  membre:         { firstName: string; lastName: string; email: string | null }
}

const ERASURE_REQUESTS_QUERY_KEY = ["erasure-requests"] as const

// Shared between the parametres queue (every request) and the membre detail page (just that
// membre's own request, so it can hide the "Erase data" button instead of letting an admin
// re-trigger a request that's already in flight and bounce off the API's 409).
// CLAUDE.md §7: pending/queued → secondary, exceptional/attention state → warning, completed
// → success.
export function erasureRequestStatusBadge(t: Translator, status: ErasureRequestStatus): { label: string; variant: "secondary" | "warning" | "success" } {
  switch (status) {
    case "REVIEW":    return { label: t("parametres.erasureRequests.status.review"),    variant: "secondary" }
    case "PENDING":   return { label: t("parametres.erasureRequests.status.pending"),   variant: "secondary" }
    case "HELD":      return { label: t("parametres.erasureRequests.status.held"),      variant: "warning"   }
    case "PROCESSED": return { label: t("parametres.erasureRequests.status.processed"), variant: "success"   }
  }
}

export function useErasureRequests(enabled = true) {
  return useQuery<ErasureRequest[]>({
    queryKey: ERASURE_REQUESTS_QUERY_KEY,
    enabled,
    queryFn:  async () => {
      const response = await fetch("/api/erasure-requests")
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors du chargement des demandes"))
      return response.json()
    },
  })
}

export function useCreateErasureRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (membreId: string) => {
      const response = await fetch("/api/erasure-requests", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ membreId }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors de l'enregistrement de la demande"))
      return response.json() as Promise<ErasureRequest>
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ERASURE_REQUESTS_QUERY_KEY }),
  })
}

export function useHoldErasureRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const response = await fetch(`/api/erasure-requests/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ hold: true, reason }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors de la mise en attente"))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ERASURE_REQUESTS_QUERY_KEY }),
  })
}

export function useReleaseErasureRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/erasure-requests/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ hold: false }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors de la levée de l'attente"))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ERASURE_REQUESTS_QUERY_KEY }),
  })
}

export function useCancelErasureRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/erasure-requests/${id}`, { method: "DELETE" })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors de l'annulation"))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ERASURE_REQUESTS_QUERY_KEY }),
  })
}

// Moves a self-service REVIEW request to PENDING — see the `approve` branch in
// src/app/api/erasure-requests/[id]/route.ts for the last-administrator check this triggers.
export function useApproveErasureRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/erasure-requests/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ approve: true }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors de la validation"))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ERASURE_REQUESTS_QUERY_KEY }),
  })
}

// ─── Portal (member self-service) ──────────────────────────────────────────────────────────
// A different endpoint (/api/portal/erasure-request, membre-scoped by session rather than
// by :id) and query key — a portal member never sees any other membre's request, so there's
// no list to share with ERASURE_REQUESTS_QUERY_KEY above. Its own type too: unlike the admin
// endpoints above, GET /api/portal/erasure-request doesn't join `membre` (the caller already
// knows who they are), so this omits the field rather than claim a shape the API never sends.
export type OwnErasureRequest = Omit<ErasureRequest, "membre">

const PORTAL_ERASURE_REQUEST_QUERY_KEY = ["portal-erasure-request"] as const

export function usePortalErasureRequest() {
  return useQuery<OwnErasureRequest | null>({
    queryKey: PORTAL_ERASURE_REQUEST_QUERY_KEY,
    queryFn:  async () => {
      const response = await fetch("/api/portal/erasure-request")
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors du chargement de la demande"))
      return response.json()
    },
  })
}

export function usePortalRequestErasure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/portal/erasure-request", { method: "POST" })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors de l'enregistrement de la demande"))
      return response.json() as Promise<OwnErasureRequest>
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PORTAL_ERASURE_REQUEST_QUERY_KEY }),
  })
}

// Only succeeds server-side while the request is still REVIEW — see the DELETE handler's
// comment in src/app/api/portal/erasure-request/route.ts for why that's the cutoff.
export function usePortalWithdrawErasureRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/portal/erasure-request", { method: "DELETE" })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors du retrait de la demande"))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PORTAL_ERASURE_REQUEST_QUERY_KEY }),
  })
}
