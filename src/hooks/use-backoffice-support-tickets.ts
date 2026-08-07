import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"
import type { SupportTicket, SupportTicketStatus } from "@/hooks/use-support-tickets"

export type { SupportTicketMessage } from "@/hooks/use-support-tickets"
export type { SupportTicket, SupportTicketStatus }

// Same shape as the tenant side's SupportTicket, plus the association's slug (needed for a
// couple of backoffice-only links) — the global inbox spans every association, so it always
// needs to name/link the one each row belongs to.
export type BackofficeSupportTicket = SupportTicket & { association: { name: string; slug: string } }

const QK = ["backoffice", "support-tickets"]

async function fetchTickets(status?: SupportTicketStatus): Promise<BackofficeSupportTicket[]> {
  const params = new URLSearchParams()
  if (status) params.set("status", status)
  const res = await fetch(`/api/backoffice/support-tickets?${params}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
  return res.json()
}

async function fetchTicket(id: string): Promise<BackofficeSupportTicket> {
  const res = await fetch(`/api/backoffice/support-tickets/${id}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
  return res.json()
}

async function replyTicket(id: string, body: string): Promise<BackofficeSupportTicket> {
  const res = await fetch(`/api/backoffice/support-tickets/${id}/messages`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de l'envoi"))
  return res.json()
}

async function patchTicket(id: string, data: { read?: true; status?: SupportTicketStatus }): Promise<BackofficeSupportTicket> {
  const res = await fetch(`/api/backoffice/support-tickets/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

export function useBackofficeSupportTickets(status?: SupportTicketStatus) {
  return useQuery({ queryKey: [...QK, status ?? "all"], queryFn: () => fetchTickets(status), staleTime: 0 })
}

export function useBackofficeSupportTicket(id: string) {
  return useQuery({ queryKey: [...QK, id], queryFn: () => fetchTicket(id), staleTime: 0, enabled: !!id })
}

function invalidate(qc: ReturnType<typeof useQueryClient>, id?: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    id ? qc.invalidateQueries({ queryKey: [...QK, id] }) : Promise.resolve(),
  ])
}

export function useReplyBackofficeSupportTicket(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => replyTicket(id, body),
    onSuccess:  () => invalidate(qc, id),
  })
}

export function usePatchBackofficeSupportTicket(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { read?: true; status?: SupportTicketStatus }) => patchTicket(id, data),
    onSuccess:  () => invalidate(qc, id),
  })
}
