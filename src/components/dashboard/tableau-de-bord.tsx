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
import { PencilSimpleIcon, CheckIcon, ArrowCounterClockwiseIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { useCurrentUser, useModules } from "@/lib/user-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ActionsTodoPanel } from "@/components/dashboard/actions-todo-panel"
import type { DashboardActionRow } from "@/lib/dashboard-actions"
import { SortableWidget } from "@/components/dashboard/sortable-widget"
import { MembresSummaryCard } from "@/components/dashboard/widgets/membres-summary-card"
import { AgendaCard } from "@/components/dashboard/widgets/agenda-card"
import { CotisationsCard } from "@/components/dashboard/widgets/cotisations-card"
import { FinancesOverviewCard } from "@/components/dashboard/widgets/finances-overview-card"
import { ActiviteRecenteCard } from "@/components/dashboard/widgets/activite-recente-card"
import { LoanedMaterialCard } from "@/components/dashboard/widgets/loaned-material-card"
import { MesTachesCard } from "@/components/dashboard/widgets/mes-taches-card"
import { setDashboardLayout, resetDashboardLayout } from "@/lib/dashboard/actions"
import {
  defaultDashboardLayout, isDashboardWidgetVisible,
  type DashboardWidget, type DashboardWidgetId,
} from "@/lib/dashboard-widgets"

type DashboardData = {
  membresActifs:         number
  // Every member regardless of status — inactive = membresTotal - membresActifs.
  membresTotal:          number
  evenementsMois:        number
  cotisationsEnAttente:  number
  cotisationsEncaissees: number
  cotisationsResteAPercevoir: number
  // null for a user without Comptabilité (see /api/dashboard) — the balance mini-stat is
  // hidden for them inside finances-overview.
  solde:                 number | null
  // null for a role that isn't allowed to see donation totals (see /api/dashboard).
  donsRecus:             number | null
  // null for the same role, mirroring donsRecus — drives the "À traiter" dons shortcut.
  donsEnAttenteCount:    number | null
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
  prochainEvenement:     { id: string; title: string; date: string; location: string | null; enCours: boolean } | null
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
  // null = no linked Membre for the current staff User (nothing can ever be assigned to
  // them) — the mes-taches widget hides entirely rather than show an always-zero tile.
  mesTaches: {
    openCount:     number
    todayCount:    number
    todayTasks:    { id: string; titre: string; status: "A_FAIRE" | "EN_COURS" | "TERMINEE" }[]
    upcomingTasks: { id: string; titre: string; status: "A_FAIRE" | "EN_COURS" | "TERMINEE"; dueDate: string | null }[]
    overdueCount:  number
    overdueTasks:  { id: string; titre: string; status: "A_FAIRE" | "EN_COURS" | "TERMINEE"; dueDate: string }[]
    membreId:      string
  } | null
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
  const { permissions } = useCurrentUser()
  const tActionsTodo = useTranslations("dashboard.actionsTodo")
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error(t("common.error"))
      return res.json()
    },
  })

  const { data: actionsData, isLoading: actionsLoading, isError: actionsError } = useQuery<{
    rows:        DashboardActionRow[]
    badgeCount:  number
    snoozedRows: (DashboardActionRow & { snoozedUntil: string })[]
  }>({
    queryKey: ["dashboard-actions"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard/actions")
      if (!res.ok) throw new Error(t("common.error"))
      return res.json()
    },
  })
  const [actionsOpen, setActionsOpen] = useState(false)

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

  const visibleLayout = useMemo(
    () => layout.filter(widget => {
      if (!isDashboardWidgetVisible(widget.id, modules, permissions)) return false
      // Permission/module alone can't know whether THIS user has a linked Membre — that
      // only comes back with the data fetch, so this one widget gets an extra data-driven
      // check on top of the synchronous gate every other widget relies on.
      if (widget.id === "mes-taches" && data && data.mesTaches === null) return false
      return true
    }),
    [layout, modules, permissions, data],
  )
  // dnd-kit addresses sortable items by id, so it gets the ids alone — sizes never enter
  // into drag ordering.
  const visibleIds = useMemo(() => visibleLayout.map(w => w.id), [visibleLayout])

  const widgetContent: Record<DashboardWidgetId, ReactNode> = {
    "membres-summary": (
      <MembresSummaryCard
        totalCount={data?.membresTotal ?? null}
        activeCount={data?.membresActifs ?? null}
        isLoading={isLoading}
      />
    ),
    "agenda-summary": (
      <AgendaCard
        evenementsMois={data?.evenementsMois ?? 0}
        prochainEvenement={data?.prochainEvenement ?? null}
        isLoading={isLoading}
      />
    ),
    "cotisations-card": (
      <CotisationsCard
        cotisationsEncaissees={data?.cotisationsEncaissees ?? 0}
        cotisationsEnAttente={data?.cotisationsEnAttente ?? 0}
        cotisationsResteAPercevoir={data?.cotisationsResteAPercevoir ?? 0}
        isLoading={isLoading}
      />
    ),
    "finances-overview": (
      <FinancesOverviewCard
        solde={data?.solde ?? null}
        donsRecus={data?.donsRecus ?? null}
        isLoading={isLoading}
      />
    ),
    "activite-recente": (
      <ActiviteRecenteCard
        ventesRecentes={data?.ventesRecentes ?? []}
        donsRecents={data?.donsRecents ?? []}
        isLoading={isLoading}
      />
    ),
    "loaned-material": (
      <LoanedMaterialCard
        materielEmpruntsListe={data?.materielEmpruntsListe ?? []}
        materielEnRetardCount={data?.materielEnRetardCount ?? 0}
        isLoading={isLoading}
      />
    ),
    "mes-taches": (
      <MesTachesCard
        openCount={data?.mesTaches?.openCount ?? 0}
        todayCount={data?.mesTaches?.todayCount ?? 0}
        todayTasks={data?.mesTaches?.todayTasks ?? []}
        upcomingTasks={data?.mesTaches?.upcomingTasks ?? []}
        overdueCount={data?.mesTaches?.overdueCount ?? 0}
        overdueTasks={data?.mesTaches?.overdueTasks ?? []}
        membreId={data?.mesTaches?.membreId ?? ""}
        isLoading={isLoading}
      />
    ),
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[1.75rem] leading-none font-medium tracking-tight sm:text-[2.5rem]">{t("dashboard.pageTitle")}</h1>
          <p className="text-base text-muted-foreground mt-1.5">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {editMode && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <ArrowCounterClockwiseIcon className="mr-1.5 size-3.5" /> {tCustomize("reset")}
            </Button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={
                <Button variant="outline" size="sm" aria-expanded={actionsOpen} onClick={() => setActionsOpen(v => !v)} />
              }>
                {tActionsTodo("trigger")}
                {!!actionsData?.badgeCount && <Badge variant="warning" className="ml-1.5">{actionsData.badgeCount}</Badge>}
                <CaretDownIcon className={cn("ml-1 size-3.5 transition-transform", actionsOpen && "rotate-180")} />
              </TooltipTrigger>
              {/* The badge counts categories ("3 types d'action"), not the total number of
                  dossiers across them — a cotisation backlog of 40 and a single late loan
                  both read as "1" if that's all that's pending. Spelled out on hover since
                  that's not obvious from the number alone. */}
              <TooltipContent>
                {actionsData?.badgeCount ? tActionsTodo("badgeHint", { count: actionsData.badgeCount }) : tActionsTodo("trigger")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {editMode ? (
            <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>
              <CheckIcon className="mr-1.5 size-3.5" /> {tCustomize("done")}
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setEditMode(true)}
                    aria-label={tCustomize("tooltip")}
                  />
                }>
                  <PencilSimpleIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{tCustomize("tooltip")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {actionsOpen && (
        <ActionsTodoPanel
          rows={actionsData?.rows ?? []}
          snoozedRows={actionsData?.snoozedRows ?? []}
          isLoading={actionsLoading}
          isError={actionsError}
        />
      )}

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 auto-rows-[8rem] gap-4">
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
