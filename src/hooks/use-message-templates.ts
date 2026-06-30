import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

export type MessageTemplate = {
  id:        string
  name:      string
  subject:   string
  body:      string
  smsBody:   string | null
  createdAt: string
  updatedAt: string
  _count:    { rules: number }
}

export type TemplateInput = { name: string; subject: string; body: string; smsBody?: string }

const KEY = ["message-templates"]

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? "Erreur")
  }
  return res.status === 204 ? null : res.json()
}

export function useMessageTemplates(options?: { enabled?: boolean }) {
  return useQuery<MessageTemplate[]>({
    queryKey:  KEY,
    queryFn:   () => fetchJson("/api/message-templates"),
    staleTime: 0,
    enabled:   options?.enabled ?? true,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEY }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
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
    onSuccess: () => invalidateAll(qc),
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
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/message-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateAll(qc),
  })
}
