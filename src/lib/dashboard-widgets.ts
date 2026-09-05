import type { AssocModules } from "@/lib/modules"

// Canonical order = today's default, hardcoded visual order — a brand-new user (no saved
// dashboardLayout) sees exactly this, unchanged from before drag-and-drop existed.
export const DASHBOARD_WIDGET_IDS = [
  "stat-membres",
  "stat-evenements",
  "stat-cotisations",
  "stat-solde",
  "stat-dons",
  // The two charts sit right under the stat tiles, which is where they have always
  // appeared: as one `finance-charts` widget declared last they were dragged up here by
  // `grid-auto-flow: dense`. That's gone now that widget order is authoritative, so the
  // position they actually had is declared rather than emergent.
  "cotisations-gauge",
  "income-expense-chart",
  "next-event",
  "cotisations-summary",
  "income-by-category",
  "recent-orders",
  "dons-recents",
  "loaned-material",
] as const

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number]

// Same list the matching app-sidebar entry uses to gate /dashboard/dons — see `roles` below.
const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"] as const

// The grid is 4 columns wide at lg (2 at sm, 1 below), and every row is one fixed unit tall
// — see the `auto-rows-` class in tableau-de-bord. A widget's `w`/`h` are how many columns
// and how many of those row units it spans. Heights being quantized to a shared unit is the
// whole point: cards line up across a row instead of each one sizing itself to its own
// content, which is what left ragged holes between a tall list and a short summary.
export const MAX_WIDGET_W = 4
export const MAX_WIDGET_H = 4

export type DashboardWidget = {
  id: DashboardWidgetId
  w:  number
  h:  number
}

// Each widget is gated on the one module whose data it actually renders. The two finance
// charts used to share a single `["cotisations", "finances"]` gate because they were one
// widget; split apart, each carries its own — a cotisations-only association no longer gets
// an empty recettes/dépenses card, and vice versa.
export const DASHBOARD_WIDGET_META: Record<DashboardWidgetId, {
  moduleKey: keyof AssocModules | (keyof AssocModules)[] | null
  // Roles allowed to see the widget, for a tile linking to a page the sidebar itself
  // restricts — undefined means every admin role, which is the case for every widget but
  // the two dons ones. Without it a SECRETAIRE would get a tile onto a page whose API 403s.
  roles?:    readonly string[]
  // Starting size, used for a brand-new dashboard and whenever a widget appears in a saved
  // layout that predates it. Only a default — the user resizes from the Personnaliser mode.
  w:         number
  h:         number
}> = {
  "stat-membres":         { moduleKey: null,                          w: 1, h: 1 },
  "stat-evenements":      { moduleKey: "evenements",                  w: 1, h: 1 },
  "stat-cotisations":     { moduleKey: "cotisations",                 w: 1, h: 1 },
  "stat-solde":           { moduleKey: "finances",                    w: 1, h: 1 },
  "stat-dons":            { moduleKey: "dons", roles: FINANCE,        w: 1, h: 1 },
  "cotisations-gauge":    { moduleKey: "cotisations",                 w: 2, h: 3 },
  "income-expense-chart": { moduleKey: "finances",                    w: 2, h: 3 },
  "next-event":           { moduleKey: "evenements",                  w: 2, h: 2 },
  "cotisations-summary":  { moduleKey: "cotisations",                 w: 2, h: 2 },
  "income-by-category":   { moduleKey: "finances",                    w: 2, h: 2 },
  "recent-orders":        { moduleKey: "boutique",                    w: 2, h: 3 },
  "dons-recents":         { moduleKey: "dons", roles: FINANCE,        w: 2, h: 3 },
  "loaned-material":      { moduleKey: "materiel",                    w: 2, h: 2 },
}

export function isDashboardWidgetVisible(id: DashboardWidgetId, modules: AssocModules, role?: string): boolean {
  const { moduleKey, roles } = DASHBOARD_WIDGET_META[id]
  if (roles && (!role || !roles.includes(role))) return false
  if (!moduleKey) return true
  if (Array.isArray(moduleKey)) return moduleKey.some(k => modules[k])
  return modules[moduleKey]
}

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === "string" && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value)
}

function clamp(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), 1), max)
}

export function defaultDashboardLayout(): DashboardWidget[] {
  return DASHBOARD_WIDGET_IDS.map(id => ({
    id,
    w: DASHBOARD_WIDGET_META[id].w,
    h: DASHBOARD_WIDGET_META[id].h,
  }))
}

// Defensive merge, same shape as parseModules(): sanitizes an arbitrary stored/incoming
// value into a valid, complete layout. Always used before trusting a dashboardLayout value,
// whether read from the DB or received from a client save request.
//
// Accepts both shapes on the way in: the original `string[]` of ids (every layout saved
// before widgets became resizable) and the current `{id,w,h}[]`. A legacy entry simply takes
// the widget's default size, so an existing dashboard keeps its ordering and picks up
// sensible sizes without a data migration.
export function parseDashboardLayout(raw: unknown): DashboardWidget[] {
  if (!Array.isArray(raw)) return defaultDashboardLayout()

  const result: DashboardWidget[] = []
  for (const entry of raw) {
    const id = isDashboardWidgetId(entry)
      ? entry
      : (typeof entry === "object" && entry !== null && isDashboardWidgetId((entry as { id?: unknown }).id)
          ? (entry as { id: DashboardWidgetId }).id
          : null)
    if (!id) continue
    // First occurrence wins — a duplicated id would otherwise render the same widget twice
    // and give dnd-kit two nodes under one key.
    if (result.some(w => w.id === id)) continue

    const meta = DASHBOARD_WIDGET_META[id]
    const size = typeof entry === "object" && entry !== null ? entry as { w?: unknown; h?: unknown } : {}
    result.push({ id, w: clamp(size.w, meta.w, MAX_WIDGET_W), h: clamp(size.h, meta.h, MAX_WIDGET_H) })
  }

  // Each widget the saved layout doesn't know about is slotted in at its canonical position
  // — right after the nearest widget that precedes it in DASHBOARD_WIDGET_IDS and is
  // actually present — rather than appended. Appending put every newly shipped widget at the
  // very bottom of the dashboard of anyone who had ever reordered theirs, which for a new
  // feature reads as "it didn't ship". Someone who deliberately moved things around keeps
  // their ordering; only the new widget is placed for them, and they can drag it after.
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (result.some(w => w.id === id)) continue
    const precede = DASHBOARD_WIDGET_IDS.slice(0, DASHBOARD_WIDGET_IDS.indexOf(id))
    // Scanned from the end so the *last* present predecessor wins — with a reordered layout
    // that's the one the new widget should sit behind, not the first one it happens to find.
    let at = 0
    for (let i = result.length - 1; i >= 0; i--) {
      if (precede.includes(result[i].id)) { at = i + 1; break }
    }
    const meta = DASHBOARD_WIDGET_META[id]
    result.splice(at, 0, { id, w: meta.w, h: meta.h })
  }

  return result
}
