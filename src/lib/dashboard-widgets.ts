import type { AssocModules } from "@/lib/modules"

// Canonical order = today's default, hardcoded visual order — a brand-new user (no saved
// dashboardLayout) sees exactly this, unchanged from before drag-and-drop existed.
export const DASHBOARD_WIDGET_IDS = [
  "stat-membres",
  "stat-evenements",
  "stat-cotisations",
  "stat-solde",
  "next-event",
  "cotisations-summary",
  "income-by-category",
  "recent-orders",
  "loaned-material",
  "finance-charts",
] as const

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number]

// `finances` gate covers both `stat-solde` and the two finance-chart widgets — cotisations
// widgets are gated on `cotisations` alone, `finance-charts` needs either (mirrors the
// `modules.cotisations || modules.finances` condition FinanceCharts already used).
export const DASHBOARD_WIDGET_META: Record<DashboardWidgetId, {
  moduleKey: keyof AssocModules | (keyof AssocModules)[] | null
  span:      string
}> = {
  "stat-membres":         { moduleKey: null,                          span: "col-span-1" },
  "stat-evenements":      { moduleKey: "evenements",                  span: "col-span-1" },
  "stat-cotisations":     { moduleKey: "cotisations",                 span: "col-span-1" },
  "stat-solde":           { moduleKey: "finances",                    span: "col-span-1" },
  "next-event":           { moduleKey: "evenements",                  span: "col-span-1 sm:col-span-2" },
  "cotisations-summary":  { moduleKey: "cotisations",                 span: "col-span-1 sm:col-span-2" },
  "income-by-category":   { moduleKey: "finances",                    span: "col-span-1 sm:col-span-2" },
  "recent-orders":        { moduleKey: "boutique",                    span: "col-span-1 sm:col-span-2" },
  "loaned-material":      { moduleKey: "materiel",                    span: "col-span-1 sm:col-span-2" },
  "finance-charts":       { moduleKey: ["cotisations", "finances"],   span: "col-span-full" },
}

export function isDashboardWidgetVisible(id: DashboardWidgetId, modules: AssocModules): boolean {
  const { moduleKey } = DASHBOARD_WIDGET_META[id]
  if (!moduleKey) return true
  if (Array.isArray(moduleKey)) return moduleKey.some(k => modules[k])
  return modules[moduleKey]
}

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === "string" && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value)
}

// Defensive merge, same shape as parseModules(): sanitizes an arbitrary stored/incoming
// value into a valid, complete ordering of all widget ids. Always used before trusting a
// dashboardLayout value, whether read from the DB or received from a client save request.
export function parseDashboardLayout(raw: unknown): DashboardWidgetId[] {
  if (!Array.isArray(raw)) return [...DASHBOARD_WIDGET_IDS]

  const known = raw.filter(isDashboardWidgetId)
  const missing = DASHBOARD_WIDGET_IDS.filter(id => !known.includes(id))
  return [...known, ...missing]
}
