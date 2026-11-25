"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, ListIcon, CalendarBlankIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { FilterSelect } from "@/components/ui/filter-select"
import { ViewToggle } from "@/components/ui/view-toggle"
import { TacheDetailSheet } from "@/components/taches/tache-detail-sheet"
import { NouvelleTacheSheet } from "@/components/taches/nouvelle-tache-sheet"
import { TachesCalendar } from "@/components/taches/taches-calendar"
import {
  useTachesPaginated, useCreateTache, useUpdateTache, useTacheCategories,
  type Tache,
} from "@/hooks/use-taches"
import type { TacheInput } from "@/lib/schemas"
import type { TacheStatusFilter } from "@/lib/tache-query"
import { isTacheOverdue, tacheDueDateLocal } from "@/lib/tache-status"
import { useHasAccess } from "@/lib/user-context"

type MembreOption = { id: string; firstName: string; lastName: string }
type ViewMode = "liste" | "planning"

const PAGE_SIZE = 25

function membreName(m: { firstName: string; lastName: string }) {
  return `${m.firstName} ${m.lastName}`
}

export function TachesView() {
  const t = useTranslations("taches")
  const tCommon = useTranslations("common")
  const searchParams = useSearchParams()
  const canEdit = useHasAccess("taches", "edit")

  const [view, setView] = useState<ViewMode>(() => (searchParams.get("view") === "planning" ? "planning" : "liste"))
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch]           = useState("")
  const [membreFilter, setMembreFilter]       = useState(() => searchParams.get("membre") ?? "")
  const [categorieFilter, setCategorieFilter] = useState(() => searchParams.get("categorie") ?? "")
  const [statusFilter, setStatusFilter]       = useState<TacheStatusFilter | "">(() => {
    const fromUrl = searchParams.get("status")
    return fromUrl === "A_FAIRE" || fromUrl === "EN_COURS" || fromUrl === "TERMINEE" || fromUrl === "EN_RETARD" ? fromUrl : ""
  })
  // "À venir" uniquement — "En retard" vit déjà dans statusFilter (voir tache-query.ts :
  // avoir le même libellé sur deux filtres indépendants pouvait produire un résultat vide
  // sans explication quand les deux étaient combinés).
  const [dueFilter, setDueFilter] = useState<"" | "upcoming">("")

  const [createOpen, setCreateOpen] = useState(false)
  const [createPrefillDate, setCreatePrefillDate] = useState<string | undefined>(undefined)
  const [editTarget, setEditTarget] = useState<Tache | null>(null)
  const [detailTarget, setDetailTarget] = useState<Tache | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const filters = {
    search:      search || undefined,
    membreId:    membreFilter || undefined,
    categorieId: categorieFilter || undefined,
    status:      statusFilter || undefined,
    // "upcoming" est résolu côté serveur (aucun timestamp calculé ici) — voir tache-query.ts.
    dueFilter:   dueFilter === "upcoming" ? ("upcoming" as const) : undefined,
  }
  const hasActiveFilters = !!(search || membreFilter || categorieFilter || statusFilter || dueFilter)

  function resetFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchInput("")
    setSearch("")
    setMembreFilter("")
    setCategorieFilter("")
    setStatusFilter("")
    setDueFilter("")
    setPage(1)
  }

  const { data: result, isLoading } = useTachesPaginated(page, PAGE_SIZE, filters)
  const taches = result?.data ?? []
  const { data: categories = [] } = useTacheCategories()
  const { data: membres = [] } = useQuery<MembreOption[]>({
    queryKey: ["membres", "all"],
    queryFn: async () => {
      const res = await fetch("/api/membres")
      return res.ok ? res.json() : []
    },
  })

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation = useCreateTache()
  const updateMutation = useUpdateTache(editTarget?.id ?? "")

  function openDetail(tache: Tache) {
    setDetailTarget(tache)
    setDetailOpen(true)
  }

  function openEdit(tache: Tache) {
    setDetailOpen(false)
    setEditTarget(tache)
  }

  async function handleCreateOrUpdate(data: TacheInput) {
    try {
      if (editTarget) {
        await updateMutation.mutateAsync(data)
        toast.success(t("view.toasts.updated"))
        setEditTarget(null)
      } else {
        await createMutation.mutateAsync(data)
        toast.success(t("view.toasts.created"))
        setCreateOpen(false)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  const columns: Column<Tache>[] = [
    {
      key: "titre", header: t("view.columns.tache"),
      cell: tache => <span className="font-medium">{tache.titre}</span>,
    },
    {
      key: "assignees", header: t("view.columns.attribueeA"),
      cell: tache => tache.assignees.length === 0
        ? <span className="text-muted-foreground">{t("detailSheet.nonAttribuee")}</span>
        : <span>{tache.assignees.map(a => membreName(a.membre)).join(", ")}</span>,
    },
    {
      key: "dueDate", header: t("view.columns.echeance"),
      cell: tache => {
        if (!tache.dueDate) return <span className="text-muted-foreground">{t("detailSheet.sansEcheance")}</span>
        const overdue = isTacheOverdue(tache)
        return <span className={overdue ? "text-destructive font-medium" : undefined}>{format(tacheDueDateLocal(tache.dueDate), "d MMM yyyy", { locale: fr })}</span>
      },
    },
    {
      key: "status", header: t("view.columns.statut"),
      cell: tache => {
        const overdue = isTacheOverdue(tache)
        const config = {
          A_FAIRE:  { label: t("status.aFaire"),  variant: "secondary" as const },
          EN_COURS: { label: t("status.enCours"), variant: "warning" as const },
          TERMINEE: { label: t("status.terminee"), variant: "success" as const },
        }[tache.status]
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant={config.variant}>{config.label}</Badge>
            {overdue && (
              <Badge variant="destructive">
                <WarningCircleIcon className="size-3" /> {t("status.enRetard")}
              </Badge>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("view.title")}
        description={t("view.count", { count: result?.total ?? 0 })}
        action={
          <div className="flex items-center gap-2">
            <ViewToggle
              options={[
                { value: "liste",    label: t("view.listeLabel"),    icon: <ListIcon className="size-3.5" /> },
                { value: "planning", label: t("view.planningLabel"), icon: <CalendarBlankIcon className="size-3.5" /> },
              ]}
              value={view}
              onChange={setView}
            />
            {canEdit && (
              <Button size="sm" onClick={() => { setCreatePrefillDate(undefined); setCreateOpen(true) }}>
                <PlusIcon className="size-4" />
                {t("view.nouvelleTache")}
              </Button>
            )}
          </div>
        }
      />

      {view === "liste" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={searchInput} onValueChange={handleSearch} placeholder={t("view.searchPlaceholder")} />
            <FilterSelect
              value={membreFilter}
              onValueChange={v => { setMembreFilter(v); setPage(1) }}
              placeholder={t("view.filterMembre")}
              options={membres.map(m => ({ value: m.id, label: membreName(m) }))}
            />
            <FilterSelect
              value={categorieFilter}
              onValueChange={v => { setCategorieFilter(v); setPage(1) }}
              placeholder={t("view.filterCategorie")}
              options={categories.map(c => ({ value: c.id, label: c.nom }))}
            />
            <FilterSelect
              value={statusFilter}
              onValueChange={v => { setStatusFilter(v as TacheStatusFilter | ""); setPage(1) }}
              placeholder={t("view.filterStatut")}
              options={[
                { value: "A_FAIRE",   label: t("status.aFaire") },
                { value: "EN_COURS",  label: t("status.enCours") },
                { value: "TERMINEE",  label: t("status.terminee") },
                { value: "EN_RETARD", label: t("status.enRetard") },
              ]}
            />
            <FilterSelect
              value={dueFilter}
              onValueChange={v => { setDueFilter(v as "" | "upcoming"); setPage(1) }}
              placeholder={t("view.filterEcheance")}
              options={[
                { value: "upcoming", label: t("view.filterEcheanceUpcoming") },
              ]}
            />
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                {t("view.resetFilters")}
              </Button>
            )}
          </div>

          <DataTable
            columns={columns}
            data={taches}
            loading={isLoading}
            keyExtractor={tache => tache.id}
            onRowClick={openDetail}
            empty={<p className="text-sm text-muted-foreground py-8 text-center">{hasActiveFilters ? t("view.emptyFiltered") : t("view.empty")}</p>}
            pagination={result ? { page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit, onPageChange: setPage } : undefined}
          />
        </>
      ) : (
        <TachesCalendar
          onTacheClick={openDetail}
          onCreateClick={canEdit ? (date) => { setCreatePrefillDate(date ? format(date, "yyyy-MM-dd") : undefined); setCreateOpen(true) } : undefined}
        />
      )}

      <TacheDetailSheet tache={detailTarget} open={detailOpen} onOpenChange={setDetailOpen} onEdit={openEdit} />

      <NouvelleTacheSheet
        open={createOpen || !!editTarget}
        onOpenChange={open => { if (!open) { setCreateOpen(false); setEditTarget(null) } }}
        editing={editTarget}
        prefill={createOpen && createPrefillDate ? { dueDate: createPrefillDate } : undefined}
        onSubmit={handleCreateOrUpdate}
        loading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  )
}
