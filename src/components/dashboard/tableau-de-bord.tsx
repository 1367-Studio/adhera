"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core"
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable"
import { restrictToParentElement } from "@dnd-kit/modifiers"
import {
  UsersIcon, CalendarBlankIcon, CoinsIcon, BankIcon, HeartIcon,
  PencilSimpleIcon, CheckIcon, ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { useCurrentUser, useModules } from "@/lib/user-context"
import { usePalette } from "@/lib/finance-palette"
import { Button } from "@/components/ui/button"
import { CotisationsGaugeCard, IncomeExpenseChart, IncomeByCategoryChart } from "@/components/dashboard/finance-charts"
import { SortableWidget } from "@/components/dashboard/sortable-widget"
import { StatTile } from "@/components/dashboard/widgets/stat-tile"
import { NextEventCard } from "@/components/dashboard/widgets/next-event-card"
import { CotisationsSummaryCard } from "@/components/dashboard/widgets/cotisations-summary-card"
import { RecentOrdersCard } from "@/components/dashboard/widgets/recent-orders-card"
import { RecentDonationsCard } from "@/components/dashboard/widgets/recent-donations-card"
import { LoanedMaterialCard } from "@/components/dashboard/widgets/loaned-material-card"
import { setDashboardLayout, resetDashboardLayout } from "@/lib/dashboard/actions"
import {
  defaultDashboardLayout, isDashboardWidgetVisible,
  type DashboardWidget, type DashboardWidgetId,
} from "@/lib/dashboard-widgets"

type DashboardData = {
  membresActifs:         number
  evenementsMois:        number
  cotisationsEnAttente:  number
  cotisationsEncaissees: number
  solde:                 number
  // null for a role that isn't allowed to see donation totals (see /api/dashboard) — the
  // stat-dons tile is hidden for those roles anyway.
  donsRecus:             number | null
  // Pending (offline, awaiting encaissement) first, then recent paid dons fill the rest —
  // up to 5 total, same shape and ordering contract as ventesRecentes below.
  donsRecents:           {
    id:          string
    amount:      number
    date:        string
    donorType:   "INDIVIDUAL" | "COMPANY"
    firstName:   string
    lastName:    string
    companyName: string | null
    anonymous:   boolean
    status:      "PENDING" | "PAID"
  }[]
  materielEnRetardCount: number
  materielEmpruntsListe: { id: string; materialName: string; borrowerName: string; expectedReturnAt: string | null; isOverdue: boolean }[]
  prochainEvenement:     { id: string; title: string; date: string; location: string | null } | null
  // Pending orders first (need action), then recent PAID sales fill out the rest — up to
  // 5 total. Each row carries its own status since the list can be a mix of both.
  ventesRecentes:        {
    id:          string
    totalAmount: number
    date:        string
    guestName:   string | null
    membre:      { firstName: string; lastName: string } | null
    status:      "PENDING" | "PAID"
  }[]
}

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

// The drag preview floats outside the grid, so it needs a pixel width rather than a column
// span — derived from the widget's own `w` so the ghost matches the card being dragged
// instead of a guess based on its id.
function overlayWidthClass(w: number) {
  if (w >= 4) return "w-[min(90vw,64rem)]"
  if (w === 3) return "w-[min(90vw,48rem)]"
  if (w === 2) return "w-[min(90vw,28rem)]"
  return "w-56"
}

const AUTOSAVE_DELAY = 600

interface Props {
  initialLayout: DashboardWidget[]
}

export function TableauDeBord({ initialLayout }: Props) {
  const t          = useTranslations()
  const tCustomize = useTranslations("dashboard.customize")
  const modules    = useModules()
  const { role }   = useCurrentUser()
  const pal        = usePalette()
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error(t("common.error"))
      return res.json()
    },
  })

  const [layout, setLayout]     = useState<DashboardWidget[]>(initialLayout)
  const [editMode, setEditMode] = useState(false)
  const [activeId, setActiveId] = useState<DashboardWidgetId | null>(null)
  const debounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLayoutRef = useRef<DashboardWidget[] | null>(null)

  // Flush-on-unmount: a debounced save still pending when the user navigates away right
  // after the last drag must fire immediately instead of being silently dropped along
  // with the timer.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (pendingLayoutRef.current) void setDashboardLayout(pendingLayoutRef.current)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const year             = new Date().getFullYear()
  const cotisationsAlert = !!data?.cotisationsEnAttente
  const soldePositive    = !data || data.solde >= 0

  const visibleLayout = useMemo(
    () => layout.filter(w => isDashboardWidgetVisible(w.id, modules, role)),
    [layout, modules, role],
  )
  // dnd-kit addresses sortable items by id, so it gets the ids alone — sizes never enter
  // into drag ordering.
  const visibleIds = useMemo(() => visibleLayout.map(w => w.id), [visibleLayout])

  // Membres/Événements are plain counts with no real financial meaning, so they get no
  // accent color (null → neutral rendering) instead of an arbitrary one each. Cotisations
  // and Solde reuse the exact same palette as the charts below (usePalette) — same yellow
  // for "en attente", same green/red for paid/negative — instead of unrelated Tailwind
  // shades, so a color means the same thing everywhere on this screen.
  const widgetContent: Record<DashboardWidgetId, ReactNode> = {
    "stat-membres": (
      <StatTile
        label={t("dashboard.stats.activeMembers")}
        value={data?.membresActifs ?? "—"}
        icon={UsersIcon}
        href="/dashboard/membres"
        accent={null}
        isLoading={isLoading}
        dark={pal.dark}
      />
    ),
    "stat-evenements": (
      <StatTile
        label={t("dashboard.stats.eventsThisMonth")}
        value={data?.evenementsMois ?? "—"}
        icon={CalendarBlankIcon}
        href="/dashboard/evenements"
        accent={null}
        isLoading={isLoading}
        dark={pal.dark}
      />
    ),
    "stat-cotisations": (
      <StatTile
        label={t("dashboard.stats.cotisationsPending")}
        value={data?.cotisationsEnAttente ?? "—"}
        icon={CoinsIcon}
        href="/dashboard/cotisations"
        accent={cotisationsAlert ? pal.enAttente : null}
        alert={cotisationsAlert}
        isLoading={isLoading}
        dark={pal.dark}
      />
    ),
    "stat-solde": (
      <StatTile
        label={t("dashboard.stats.financialBalance")}
        value={data ? fmt(data.solde) : "—"}
        icon={BankIcon}
        href="/dashboard/finances"
        accent={soldePositive ? pal.recettes : pal.depenses}
        isLoading={isLoading}
        dark={pal.dark}
      />
    ),
    "stat-dons": (
      <StatTile
        label={t("dashboard.stats.donationsReceived", { year })}
        value={data?.donsRecus != null ? fmt(data.donsRecus) : "—"}
        icon={HeartIcon}
        // Straight to the donations list, not the forms tab the page defaults to — the
        // whole point of the tile is to land on the dons themselves.
        href="/dashboard/dons?tab=dons"
        accent={null}
        isLoading={isLoading}
        dark={pal.dark}
      />
    ),
    "next-event": (
      <NextEventCard prochainEvenement={data?.prochainEvenement ?? null} isLoading={isLoading} />
    ),
    "cotisations-summary": (
      <CotisationsSummaryCard
        cotisationsEncaissees={data?.cotisationsEncaissees ?? 0}
        cotisationsEnAttente={data?.cotisationsEnAttente ?? 0}
        isLoading={isLoading}
      />
    ),
    "income-by-category": <IncomeByCategoryChart />,
    "recent-orders": (
      <RecentOrdersCard ventesRecentes={data?.ventesRecentes ?? []} isLoading={isLoading} />
    ),
    "dons-recents": (
      <RecentDonationsCard donsRecents={data?.donsRecents ?? []} isLoading={isLoading} />
    ),
    "loaned-material": (
      <LoanedMaterialCard
        materielEmpruntsListe={data?.materielEmpruntsListe ?? []}
        materielEnRetardCount={data?.materielEnRetardCount ?? 0}
        isLoading={isLoading}
      />
    ),
    "cotisations-gauge":    <CotisationsGaugeCard />,
    "income-expense-chart": <IncomeExpenseChart />,
  }

  function persist(next: DashboardWidget[]) {
    pendingLayoutRef.current = next
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDashboardLayout(next)
        .catch(() => toast.error(t("common.networkError")))
        .finally(() => { pendingLayoutRef.current = null })
    }, AUTOSAVE_DELAY)
  }

  function handleResize(id: DashboardWidgetId, size: { w: number; h: number }) {
    setLayout(prev => {
      const next = prev.map(entry => (entry.id === id ? { ...entry, ...size } : entry))
      persist(next)
      return next
    })
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(e.active.id as DashboardWidgetId)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    setLayout(prev => {
      const oldIndex = prev.findIndex(w => w.id === active.id)
      const newIndex = prev.findIndex(w => w.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      const next = arrayMove(prev, oldIndex, newIndex)
      persist(next)
      return next
    })
  }

  const activeWidth = layout.find(w => w.id === activeId)?.w ?? 1

  function handleReset() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    pendingLayoutRef.current = null
    setLayout(defaultDashboardLayout())
    resetDashboardLayout().catch(() => toast.error(t("common.networkError")))
  }

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {editMode && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <ArrowCounterClockwiseIcon className="mr-1.5 size-3.5" /> {tCustomize("reset")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditMode(v => !v)}>
            {editMode
              ? <><CheckIcon className="mr-1.5 size-3.5" /> {tCustomize("done")}</>
              : <><PencilSimpleIcon className="mr-1.5 size-3.5" /> {tCustomize("customize")}</>
            }
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToParentElement]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visibleIds} strategy={rectSortingStrategy}>
          {/* Fixed row unit (see DASHBOARD_WIDGET_META) is what makes a widget's `h`
              meaningful and what keeps cards on the same row the same height. Plain flow,
              not `grid-auto-flow: dense`: dense backfilled gaps by pulling later widgets
              forward, so a card could jump somewhere the user never dragged it. With sizes
              under the user's control, honouring their order beats auto-compacting. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 auto-rows-[7rem] gap-4">
            {visibleLayout.map(({ id, w, h }) => (
              <SortableWidget
                key={id}
                id={id}
                w={w}
                h={h}
                editMode={editMode}
                dragHint={tCustomize("dragHint")}
                resizeHint={tCustomize("resizeHint")}
                onResize={size => handleResize(id, size)}
              >
                {widgetContent[id]}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeId ? (
            <div className={cn(overlayWidthClass(activeWidth), "shadow-lg scale-[1.02] rounded-xl")}>
              {widgetContent[activeId]}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
