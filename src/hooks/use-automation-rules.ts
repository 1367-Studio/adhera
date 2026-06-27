import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

export type RuleStatus     = "ACTIVE" | "PAUSED" | "DONE"
export type TriggerType    = "SCHEDULED_ONCE" | "SCHEDULED_RECURRING" | "EVENT_COTISATION_DUE" | "EVENT_PAYMENT_OVERDUE" | "EVENT_REMINDER"

export type AutomationRule = {
  id:            string
  name:          string
  templateId:    string
  triggerType:   TriggerType
  triggerConfig: Record<string, unknown>
  recipients:    string
  status:        RuleStatus
  lastRunAt:     string | null
  nextRunAt:     string | null
  createdAt:     string
  template:      { name: string }
}

export type RuleInput = {
  name:          string
  templateId:    string
  triggerType:   TriggerType
  triggerConfig: Record<string, unknown>
  recipients:    string
}

const KEY = ["automation-rules"]

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? "Erreur")
  }
  return res.status === 204 ? null : res.json()
}

export function useAutomationRules() {
  return useQuery<AutomationRule[]>({
    queryKey:  KEY,
    queryFn:   () => fetchJson("/api/automation-rules"),
    staleTime: 0,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEY }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useCreateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RuleInput) =>
      fetchJson("/api/automation-rules", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateRule(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<RuleInput & { status: RuleStatus }>) =>
      fetchJson(`/api/automation-rules/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/automation-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useToggleRuleStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RuleStatus }) =>
      fetchJson(`/api/automation-rules/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status }),
      }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useTestSendRule() {
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/automation-rules/${id}/test`, { method: "POST" }),
  })
}
