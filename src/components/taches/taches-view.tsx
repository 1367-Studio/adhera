"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, ListIcon, CalendarBlankIcon, WarningCircleIcon, ListChecksIcon, ClockIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { FilterSelect } from "@/components/ui/filter-select"
import { ViewToggle } from "@/components/ui/view-toggle"
import { StatTile } from "@/components/dashboard/widgets/stat-tile"
import { TacheDetailSheet } from "@/components/taches/tache-detail-sheet"
import { NouvelleTacheSheet } from "@/components/taches/nouvelle-tache-sheet"
import { TachesCalendar } from "@/components/taches/taches-calendar"
import {
  useTachesPaginated, useCreateTache, useUpdateTache, useTacheCategories, useTacheSummary, useTache,
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
  const router = useRouter()
  const pathname = usePathname()
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
  // sans explication quand les deux étaient combinés). "soon7"/"today" n'apparaissent dans
  // aucun FilterSelect — atteignables seulement via les cards de résumé ci-dessous et le
  // deep-link ?dueFilter=today de la carte dashboard "Mes tâches" (FORM-118).
  const [dueFilter, setDueFilter] = useState<"" | "upcoming" | "soon7" | "today">(() => {
    const fromUrl = searchParams.get("dueFilter")
    return fromUrl === "upcoming" || fromUrl === "soon7" || fromUrl === "today" ? fromUrl : ""
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [createPrefillDate, setCreatePrefillDate] = useState<string | undefined>(undefined)
  const [editTarget, setEditTarget] = useState<Tache | null>(null)
  const [detailTarget, setDetailTarget] = useState<Tache | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // Deep-link ?tache=<id> — clic sur une ligne "Aujourd'hui" de la carte dashboard "Mes
  // tâches" (FORM-118) : ouvre directement le détail, sans dupliquer TacheDetailSheet côté
  // dashboard. Le ref évite de rouvrir le sheet si l'utilisateur le ferme puis retouche la
  // page sans changer d'URL. Le paramètre est retiré de l'URL dès qu'il est consommé (trouvé
  // ou en erreur) — sinon fermer le sheet puis cliquer une autre ligne laisse ?tache=<ancien
  // id> dans l'URL, qui rouvrirait la mauvaise tâche après un rafraîchissement ou un lien
  // partagé dans cet état.
  const openedFromUrlRef = useRef(false)
  const tacheIdFromUrl = searchParams.get("tache")
  const { data: tacheFromUrl, isError: tacheFromUrlError } = useTache(!openedFromUrlRef.current ? tacheIdFromUrl : null)
  useEffect(() => {
    if (openedFromUrlRef.current || !tacheIdFromUrl) return
    if (tacheFromUrl) {
      openedFromUrlRef.current = true
      setDetailTarget(tacheFromUrl)
      setDetailOpen(true)
    } else if (tacheFromUrlError) {
      // Tâche supprimée, ou appartenant à une autre association — même traitement silencieux
      // qu'une 404 ailleurs dans l'app, mais avec un toast ici puisque rien d'autre à l'écran
      // n'indique que le clic depuis le dashboard n'a rien ouvert.
      openedFromUrlRef.current = true
      toast.error(t("view.toasts.tacheIntrouvable"))
    } else {
      return
    }
    const params = new URLSearchParams(searchParams.toString())
    params.delete("tache")
    router.replace(params.toString() ? `${pathname}?${params}` : pathname, { scroll: false })
  }, [tacheFromUrl, tacheFromUrlError, tacheIdFromUrl, searchParams, pathname, router, t])

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
    // Résolus côté serveur (aucun timestamp calculé ici) — voir tache-query.ts.
    dueFilter:   dueFilter || undefined,
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

  // Un card de résumé promet un nombre qui ne tient compte que du filtre "Membre" (voir
  // useTacheSummary ci-dessous) — le cliquer doit donc aussi vider search/catégorie, sinon la
  // liste en dessous peut afficher moins de lignes que ce que le card annonçait, sans rien à
  // l'écran qui explique pourquoi (FORM-118, retour UX).
  function applySummaryFilter(next: { status: TacheStatusFilter | ""; due: "" | "soon7" }) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchInput("")
    setSearch("")
    setCategorieFilter("")
    setStatusFilter(next.status)
    setDueFilter(next.due)
    setPage(1)
  }

  const { data: result, isLoading } = useTachesPaginated(page, PAGE_SIZE, filters)
  const taches = result?.data ?? []
  // Cards de résumé (FORM-118, commentaire Emmanuelle) — réagit au filtre "Membre" uniquement,
  // jamais à statusFilter/dueFilter (sinon cliquer sur un card ferait aussi disparaître son
  // propre compteur).
  const { data: summary } = useTacheSummary(membreFilter || undefined)
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
          {/* Même StatTile que le dashboard/Matériel/Dons : chaque card applique son filtre à
              la liste ci-dessous (FORM-118, commentaire Emmanuelle). Une tâche peut compter
              dans plusieurs cards (ex. "En cours" en retard compte aussi dans "En retard"). */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile
              label={t("status.aFaire")}
              value={summary?.aFaire ?? 0}
              icon={ListChecksIcon}
              isLoading={!summary}
              active={statusFilter === "A_FAIRE"}
              onClick={() => applySummaryFilter({ status: "A_FAIRE", due: "" })}
            />
            <StatTile
              label={t("status.enCours")}
              value={summary?.enCours ?? 0}
              icon={ClockIcon}
              isLoading={!summary}
              active={statusFilter === "EN_COURS"}
              onClick={() => applySummaryFilter({ status: "EN_COURS", due: "" })}
            />
            <StatTile
              label={t("view.stats.echeanceSous7Jours")}
              value={summary?.echeanceSous7Jours ?? 0}
              icon={CalendarBlankIcon}
              isLoading={!summary}
              active={dueFilter === "soon7"}
              onClick={() => applySummaryFilter({ status: "", due: "soon7" })}
            />
            <StatTile
              label={t("status.enRetard")}
              value={summary?.enRetard ?? 0}
              icon={WarningCircleIcon}
              isLoading={!summary}
              active={statusFilter === "EN_RETARD"}
              onClick={() => applySummaryFilter({ status: "EN_RETARD", due: "" })}
            />
          </div>

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
              onValueChange={v => { setDueFilter(v as "" | "upcoming" | "soon7" | "today"); setPage(1) }}
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
