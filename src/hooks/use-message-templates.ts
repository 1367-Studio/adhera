import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

export type MessageTemplate = {
  id:        string
  name:      string
  subject:   string
  body:      string
  createdAt: string
  updatedAt: string
  _count:    { rules: number }
}

export type TemplateInput = { name: string; subject: string; body: string }

const KEY = ["message-templates"]

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? "Erreur")
  }
  return res.status === 204 ? null : res.json()
}

export function useMessageTemplates() {
  return useQuery<MessageTemplate[]>({
    queryKey: KEY,
    queryFn:  () => fetchJson("/api/message-templates"),
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TemplateInput) =>
      fetchJson("/api/message-templates", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<TemplateInput>) =>
      fetchJson(`/api/message-templates/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/message-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
