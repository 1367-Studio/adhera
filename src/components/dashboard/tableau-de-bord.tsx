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
  UsersIcon, CalendarBlankIcon, CoinsIcon, BankIcon,
  PencilSimpleIcon, CheckIcon, ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { useModules } from "@/lib/user-context"
import { usePalette } from "@/lib/finance-palette"
import { Button } from "@/components/ui/button"
import { FinanceCharts, IncomeByCategoryChart } from "@/components/dashboard/finance-charts"
import { SortableWidget } from "@/components/dashboard/sortable-widget"
import { StatTile } from "@/components/dashboard/widgets/stat-tile"
import { NextEventCard } from "@/components/dashboard/widgets/next-event-card"
import { CotisationsSummaryCard } from "@/components/dashboard/widgets/cotisations-summary-card"
import { RecentOrdersCard } from "@/components/dashboard/widgets/recent-orders-card"
import { LoanedMaterialCard } from "@/components/dashboard/widgets/loaned-material-card"
import { setDashboardLayout, resetDashboardLayout } from "@/lib/dashboard/actions"
import {
  DASHBOARD_WIDGET_IDS, DASHBOARD_WIDGET_META, isDashboardWidgetVisible,
  type DashboardWidgetId,
} from "@/lib/dashboard-widgets"

type DashboardData = {
  membresActifs:         number
  evenementsMois:        number
  cotisationsEnAttente:  number
  cotisationsEncaissees: number
  solde:                 number
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

function overlayWidthClass(id: DashboardWidgetId) {
  if (id === "finance-charts") return "w-[min(90vw,64rem)]"
  if (id.startsWith("stat-")) return "w-56"
  return "w-[min(90vw,28rem)]"
}

const AUTOSAVE_DELAY = 600

interface Props {
  initialLayout: DashboardWidgetId[]
}

export function TableauDeBord({ initialLayout }: Props) {
  const t          = useTranslations()
  const tCustomize = useTranslations("dashboard.customize")
  const modules    = useModules()
  const pal        = usePalette()
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error(t("common.error"))
      return res.json()
    },
  })

  const [order, setOrder]       = useState<DashboardWidgetId[]>(initialLayout)
  const [editMode, setEditMode] = useState(false)
  const [activeId, setActiveId] = useState<DashboardWidgetId | null>(null)
  const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingOrderRef = useRef<DashboardWidgetId[] | null>(null)

  // Flush-on-unmount: a debounced save still pending when the user navigates away right
  // after the last drag must fire immediately instead of being silently dropped along
  // with the timer.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (pendingOrderRef.current) void setDashboardLayout(pendingOrderRef.current)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const cotisationsAlert = !!data?.cotisationsEnAttente
  const soldePositive    = !data || data.solde >= 0

  const visibleOrder = useMemo(
    () => order.filter(id => isDashboardWidgetVisible(id, modules)),
    [order, modules],
  )

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
    "loaned-material": (
      <LoanedMaterialCard
        materielEmpruntsListe={data?.materielEmpruntsListe ?? []}
        materielEnRetardCount={data?.materielEnRetardCount ?? 0}
        isLoading={isLoading}
      />
    ),
    "finance-charts": <FinanceCharts />,
  }

  function persist(next: DashboardWidgetId[]) {
    pendingOrderRef.current = next
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDashboardLayout(next)
        .catch(() => toast.error(t("common.networkError")))
        .finally(() => { pendingOrderRef.current = null })
    }, AUTOSAVE_DELAY)
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(e.active.id as DashboardWidgetId)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    setOrder(prev => {
      const oldIndex = prev.indexOf(active.id as DashboardWidgetId)
      const newIndex = prev.indexOf(over.id as DashboardWidgetId)
      const next = arrayMove(prev, oldIndex, newIndex)
      persist(next)
      return next
    })
  }

  function handleReset() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    pendingOrderRef.current = null
    setOrder([...DASHBOARD_WIDGET_IDS])
    resetDashboardLayout().catch(() => toast.error(t("common.networkError")))
  }

  return (
    <div className="space-y-6 py-4">
      <div
        className="flex items-start justify-between gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationFillMode: "both" }}
      >
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
        <SortableContext items={visibleOrder} strategy={rectSortingStrategy}>
          <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4", "[grid-auto-flow:dense]")}>
            {visibleOrder.map(id => (
              <SortableWidget
                key={id}
                id={id}
                span={DASHBOARD_WIDGET_META[id].span}
                editMode={editMode}
                dragHint={tCustomize("dragHint")}
              >
                {widgetContent[id]}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeId ? (
            <div className={cn(overlayWidthClass(activeId), "shadow-lg scale-[1.02] rounded-xl")}>
              {widgetContent[activeId]}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
