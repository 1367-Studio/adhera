import { useQuery } from "@tanstack/react-query"

export type AutomationLogEntry = {
  id:      string
  sentAt:  string
  subject: string | null
  rule:    { name: string }
  membre:  { firstName: string; lastName: string; email: string | null } | null
}

export type LogsPage = {
  logs:     AutomationLogEntry[]
  total:    number
  page:     number
  pageSize: number
}

export function useAutomationLogs(page = 1, ruleId?: string) {
  const params = new URLSearchParams({ page: String(page) })
  if (ruleId) params.set("ruleId", ruleId)

  return useQuery<LogsPage>({
    queryKey: ["automation-logs", page, ruleId],
    queryFn:  () => fetch(`/api/automation-logs?${params}`).then(r => r.json()),
  })
}
