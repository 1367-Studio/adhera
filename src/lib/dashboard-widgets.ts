import type { AssocModules } from "@/lib/modules"
import { hasAccess, type AccessArea, type ResolvedPermissions } from "@/lib/permissions"

// Canonical order = today's default, hardcoded visual order — a brand-new user (no saved
// dashboardLayout) sees exactly this, unchanged from before drag-and-drop existed.
//
// FORM-120 regrouped the former 13 widgets (5 stat tiles + 2 charts + 6 summary cards) into
// these 6 — each now shows what used to take 2-4 separate cards (e.g. membres-summary folds
// in the actifs/total/inactifs + capacité jauge that used to live outside the widget grid
// entirely). parseDashboardLayout() below already tolerates ids disappearing/appearing
// between releases, so this rename needed no migration script.
// Order chosen so same-height widgets land next to each other: the grid uses plain
// (sparse) auto-flow, not `grid-auto-flow: dense` (see the grid div in tableau-de-bord), so
// two adjacent widgets of different heights leave a permanent empty gap the layout never
// backfills. membres-summary/agenda-summary are both h:2 (clean row); cotisations-card and
// finances-overview are both w:4 (always their own full row, no adjacency gap possible).
// activite-recente (h:3) next to loaned-material (h:2) is the one unavoidable mismatch, left
// for last so any resulting gap trails at the bottom of the page rather than interrupting it.
export const DASHBOARD_WIDGET_IDS = [
  "membres-summary",
  "agenda-summary",
  "cotisations-card",
  "finances-overview",
  "activite-recente",
  "loaned-material",
] as const

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number]

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
  // Area (FORM-34) the user must be able to read to see the widget — the same area that
  // gates the page the tile links to and the API behind its figures, so nobody gets a tile
  // onto a page they cannot open (e.g. the balance for someone without Comptabilité). An
  // array means "any of these areas is enough" — for a widget merging content that used to
  // be gated independently (e.g. activite-recente = former boutique-only + dons-only cards),
  // a single area would silently drop the whole card for a user who only had the other one.
  area:      AccessArea | AccessArea[]
  // Starting size, used for a brand-new dashboard and whenever a widget appears in a saved
  // layout that predates it. Only a default — the user resizes from the Personnaliser mode.
  w:         number
  h:         number
}> = {
  "membres-summary":   { moduleKey: null,          area: "membres",      w: 2, h: 2 },
  "agenda-summary":    { moduleKey: "evenements",  area: "evenements",   w: 2, h: 2 },
  // w:4 (not 2): the merged header summary (encaissé/reste à percevoir/en attente) plus the
  // full 5-status gauge legend doesn't fit a 2-column h:3 slot without the grid's
  // overflow-hidden clipping it — see sortable-widget.tsx's `[&>*]:h-full overflow-hidden`.
  // Full width also means this card is always alone on its row, so it can never create the
  // kind of adjacency gap a narrower, taller-than-its-neighbor card would.
  "cotisations-card":  { moduleKey: "cotisations", area: "adhesions",    w: 4, h: 4 },
  // Still gated on "comptabilite" alone (not a union with "dons") — the charts and solde are
  // the dominant content. A user with only dons access and no comptabilite loses the merged
  // card entirely rather than a standalone dons tile; see finances-overview-card.tsx's own
  // comment on hiding (not "—") the dons mini-stat for the inverse case.
  "finances-overview": { moduleKey: "finances",    area: "comptabilite", w: 4, h: 4 },
  // boutique OR dons — either module alone still has recent activity worth a tab, and the
  // area gate mirrors that: a user with only "dons" read access (no "boutique") still needs
  // to see this card for their Dons tab, same as the reverse. A single area here would have
  // silently hidden the whole card — including the tab they *do* have permission for — for
  // anyone missing the other one.
  "activite-recente":  { moduleKey: ["boutique", "dons"], area: ["boutique", "dons"], w: 2, h: 3 },
  "loaned-material":   { moduleKey: "materiel",    area: "materiel",     w: 2, h: 2 },
}

export function isDashboardWidgetVisible(id: DashboardWidgetId, modules: AssocModules, permissions: ResolvedPermissions): boolean {
  const { moduleKey, area } = DASHBOARD_WIDGET_META[id]
  const areas = Array.isArray(area) ? area : [area]
  if (!areas.some(a => hasAccess(permissions, a, "read"))) return false
  if (!moduleKey) return true
  if (Array.isArray(moduleKey)) return moduleKey.some(moduleName => modules[moduleName])
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
