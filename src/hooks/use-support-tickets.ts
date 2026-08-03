import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"

export type SupportTicketStatus = "OUVERT" | "FERME"

export type SupportTicketMessage = {
  id:        string
  body:      string
  createdAt: string
  authorId:  string
  author:    { name: string | null; role: string }
}

export type SupportTicket = {
  id:                    string
  subject:               string
  status:                SupportTicketStatus
  lastMessageAt:         string
  lastMessageAuthorRole: string
  unread:                boolean
  createdAt:             string
  author:                { name: string | null; email: string }
  association:           { name: string }
  messages?:             SupportTicketMessage[]
}

const QK = ["support-tickets"]

async function fetchTickets(): Promise<SupportTicket[]> {
  const res = await fetch("/api/support-tickets")
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
  return res.json()
}

async function fetchTicket(id: string): Promise<SupportTicket> {
  const res = await fetch(`/api/support-tickets/${id}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
  return res.json()
}

async function createTicket(data: { subject: string; body: string }): Promise<SupportTicket> {
  const res = await fetch("/api/support-tickets", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json()
}

async function replyTicket(id: string, body: string): Promise<SupportTicket> {
  const res = await fetch(`/api/support-tickets/${id}/messages`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de l'envoi"))
  return res.json()
}

async function patchTicket(id: string, data: { read?: true; status?: "FERME" }): Promise<SupportTicket> {
  const res = await fetch(`/api/support-tickets/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

export function useSupportTickets(options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: QK, queryFn: fetchTickets, staleTime: 0, enabled: options.enabled ?? true })
}

export function useSupportTicket(id: string) {
  return useQuery({ queryKey: [...QK, id], queryFn: () => fetchTicket(id), staleTime: 0, enabled: !!id })
}

function invalidate(qc: ReturnType<typeof useQueryClient>, id?: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    id ? qc.invalidateQueries({ queryKey: [...QK, id] }) : Promise.resolve(),
  ])
}

export function useCreateSupportTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createTicket,
    onSuccess:  () => invalidate(qc),
  })
}

export function useReplySupportTicket(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => replyTicket(id, body),
    onSuccess:  () => invalidate(qc, id),
  })
}

export function usePatchSupportTicket(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { read?: true; status?: "FERME" }) => patchTicket(id, data),
    onSuccess:  () => invalidate(qc, id),
  })
}
