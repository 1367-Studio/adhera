"use client"

import { useState, useMemo, useEffect } from "react"
import {
  PlusIcon, PackageIcon, MapPinIcon, ClockIcon, CheckIcon, XIcon, WarningCircleIcon,
  CheckCircleIcon, HandshakeIcon, CalendarCheckIcon, WrenchIcon,
} from "@phosphor-icons/react/dist/ssr";
import { StatTile } from "@/components/dashboard/widgets/stat-tile"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useMateriel, useConfirmLoan, useRefuseLoan, type Material, type MaterialStatus, type PendingDemande } from "@/hooks/use-materiel"
import { MaterialModal } from "@/components/materiel/material-modal"
import { MaterialDetailSheet } from "@/components/materiel/material-detail-sheet"
import { MaterielStatsCharts } from "@/components/materiel/materiel-stats-charts"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SearchInput } from "@/components/ui/search-input"
import { cn } from "@/lib/utils"
import { useHasAccess } from "@/lib/user-context"

type Translator = ReturnType<typeof useTranslations>

function getStatusConfig(t: Translator): Record<MaterialStatus, { label: string; dot: string; variant: "success" | "default" | "warning" | "secondary" | "destructive" }> {
  return {
    DISPONIBLE:     { label: t("materiel.form.status.disponible"), dot: "bg-green-500", variant: "success" },
    EN_USE:         { label: t("materiel.form.status.enUse"),      dot: "bg-blue-500",  variant: "default" },
    EN_MAINTENANCE: { label: t("materiel.view.maintenancePill"),    dot: "bg-amber-400", variant: "warning" },
    HORS_SERVICE:   { label: t("materiel.form.status.horsService"), dot: "bg-gray-400",  variant: "secondary" },
    PERDU:          { label: t("materiel.form.status.perdu"),       dot: "bg-red-500",   variant: "destructive" },
  }
}

// The status chips' rule — also what the stat tiles count, so a tile and its filter agree.
function matchesStatusFilter(material: Material, filterValue: string): boolean {
  if (filterValue === "ALL")        return true
  if (filterValue === "EN_USE")     return material.status === "EN_USE" || material.loanedQty > material.reservedQty
  if (filterValue === "RESERVE")    return material.reservedQty > 0
  if (filterValue === "DISPONIBLE") return material.status === "DISPONIBLE" && material.availableQty > 0
  return material.status === filterValue
}

function getFilterOptions(t: Translator) {
  return [
    { value: "ALL",            label: t("materiel.view.filters.all")           },
    { value: "DISPONIBLE",     label: t("materiel.view.filters.disponibles")   },
    { value: "EN_USE",         label: t("materiel.view.filters.enUtilisation") },
    { value: "RESERVE",        label: t("materiel.view.filters.reserves")      },
    { value: "EN_MAINTENANCE", label: t("materiel.view.filters.maintenance")   },
    { value: "HORS_SERVICE",   label: t("materiel.view.filters.horsService")   },
    { value: "PERDU",          label: t("materiel.view.filters.perdus")        },
  ]
}

function DemandeRow({ demande, material, onOpen }: { demande: PendingDemande; material: Material; onOpen: () => void }) {
  const t = useTranslations()
  const confirmLoan = useConfirmLoan(material.id)
  const refuseLoan  = useRefuseLoan(material.id)
  const busy        = confirmLoan.isPending || refuseLoan.isPending
  // FORM-34: accepting / refusing a request changes the loan — "materiel" edit only.
  const canEditMateriel = useHasAccess("materiel", "edit")
  const name        = demande.membre
    ? `${demande.membre.firstName} ${demande.membre.lastName}`
    : demande.borrowerName ?? "—"

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 hover:bg-muted/20 transition-colors">
      <div className="flex-1 min-w-0">
        <button type="button" onClick={onOpen} className="text-left hover:underline text-sm font-medium truncate block">
          {material.name}
        </button>
        <p className="text-xs text-muted-foreground truncate">
          {name}{demande.quantity > 1 && ` · ×${demande.quantity}`}
          {demande.expectedReturnAt && t("materiel.view.returnExpected", { date: new Date(demande.expectedReturnAt).toLocaleDateString("fr-FR") })}
        </p>
      </div>
      {canEditMateriel && (
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            try { await confirmLoan.mutateAsync(demande.id); toast.success(t("materiel.view.toasts.confirmed")) }
            catch (err) { toast.error(err instanceof Error ? err.message : t("common.error")) }
          }}
          className="text-green-700 dark:text-green-400"
        >
          <CheckIcon className="size-3" /> {t("materiel.view.accept")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            try { await refuseLoan.mutateAsync(demande.id); toast.success(t("materiel.view.toasts.refused")) }
            catch (err) { toast.error(err instanceof Error ? err.message : t("common.error")) }
          }}
          className="text-destructive"
        >
          <XIcon className="size-3" /> {t("materiel.view.refuse")}
        </Button>
      </div>
      )}
    </div>
  )
}

function MaterialCard({ material, onClick }: { material: Material; onClick: () => void }) {
  const t = useTranslations()
  const statusConfig = getStatusConfig(t)
  // availableQty already excludes future-dated reservations, so it hitting 0 means the item
  // is genuinely unavailable today — a reservation alone can't trigger this branch, it only
  // ever shows up via the "reservedQty réservé" badge below.
  const cfg = material.status !== "DISPONIBLE"
    ? statusConfig[material.status]
    : material.availableQty === 0
      ? statusConfig.EN_USE
      : statusConfig.DISPONIBLE

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border bg-card hover:bg-muted/30 transition-colors p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {material.imageUrl ? (
            <img src={material.imageUrl} alt="" className="size-9 rounded-lg object-cover shrink-0 border" />
          ) : (
            <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <PackageIcon className="size-4 text-muted-foreground/50" />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{material.name}</p>
            {material.category && <p className="text-xs text-muted-foreground truncate">{material.category}</p>}
          </div>
        </div>
        <Badge variant={cfg.variant}>{cfg.label}</Badge>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          {material.location && (
            <span className="flex items-center gap-1 truncate">
              <MapPinIcon className="size-3 shrink-0" />
              {material.location}
            </span>
          )}
          {material.serialNumber && (
            <span className="font-mono truncate">#{material.serialNumber}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {material.overdueCount > 0 && (
            <Badge variant="destructive">
              <WarningCircleIcon className="size-2.5" />
              {t("materiel.view.overdueCount", { count: material.overdueCount })}
            </Badge>
          )}
          {material.pendingDemandesCount > 0 && (
            <Badge variant="warning">
              <ClockIcon className="size-2.5" />
              {material.pendingDemandesCount}
            </Badge>
          )}
          {material.reservedQty > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("materiel.view.reservedCount", { count: material.reservedQty })}
            </span>
          )}
          <span className={cn(
            "shrink-0 font-medium",
            material.availableQty === 0 ? "text-red-600" : material.loanedQty > 0 ? "text-amber-600" : "text-green-600",
          )}>
            {t("materiel.view.availableOf", { available: material.availableQty, total: material.quantity })}
          </span>
        </div>
      </div>
    </button>
  )
}

export function MaterielView() {
  const t = useTranslations()
  const filterOptions = getFilterOptions(t)
  // FORM-34: a "read" user browses the inventory and its loans but adds nothing.
  const canEditMateriel = useHasAccess("materiel", "edit")
  const [searchInput,  setSearchInput]  = useState("")
  const [search,       setSearch]       = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [createOpen,   setCreateOpen]   = useState(false)
  const [selected,     setSelected]     = useState<Material | null>(null)
  const [sheetOpen,    setSheetOpen]    = useState(false)

  useEffect(() => {
    const timeoutId = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(timeoutId)
  }, [searchInput])

  const { data: materials = [], isLoading } = useMateriel(search || undefined)

  const filtered = useMemo(
    () => materials.filter(material => matchesStatusFilter(material, statusFilter)),
    [materials, statusFilter],
  )

  // Counted with the same rule as the filter each tile applies, so clicking « 3 Disponibles »
  // always lists exactly 3 articles.
  const stats = useMemo(() => {
    const countMatching = (filterValue: string) =>
      materials.filter(material => matchesStatusFilter(material, filterValue)).length
    return {
      total:       materials.length,
      disponible:  countMatching("DISPONIBLE"),
      enPret:      countMatching("EN_USE"),
      reserve:     countMatching("RESERVE"),
      maintenance: countMatching("EN_MAINTENANCE"),
    }
  }, [materials])

  function openDetail(m: Material) {
    setSelected(m)
    setSheetOpen(true)
  }

  return (
    <div className="space-y-6 py-4">
      <PageHeader
        title={t("materiel.view.title")}
        description={t("materiel.view.description")}
        action={canEditMateriel ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" /> {t("materiel.view.add")}
          </Button>
        ) : undefined}
      />

      {/* Same StatTile as the dashboard, Dons, Boutique and Finances. Each tile applies its
          status filter to the list below. */}
      {!isLoading && materials.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { filterValue: "ALL",            label: t("materiel.view.statsLabels.articles"),    value: stats.total,       icon: PackageIcon },
            { filterValue: "DISPONIBLE",     label: t("materiel.view.statsLabels.disponibles"), value: stats.disponible,  icon: CheckCircleIcon },
            { filterValue: "EN_USE",         label: t("materiel.view.statsLabels.enPret"),      value: stats.enPret,      icon: HandshakeIcon },
            { filterValue: "RESERVE",        label: t("materiel.view.statsLabels.reserves"),    value: stats.reserve,     icon: CalendarCheckIcon },
            { filterValue: "EN_MAINTENANCE", label: t("materiel.view.statsLabels.maintenance"), value: stats.maintenance, icon: WrenchIcon },
          ].map(statTile => (
            <StatTile
              key={statTile.filterValue}
              label={statTile.label}
              value={statTile.value}
              icon={statTile.icon}
              onClick={() => setStatusFilter(statTile.filterValue)}
              isLoading={false}
            />
          ))}
        </div>
      )}

      {!isLoading && materials.length > 0 && <MaterielStatsCharts />}

      {/* Pending demandes */}
      {(() => {
        const allPending = materials.flatMap(m => (m.pendingDemandes ?? []).map(d => ({ demande: d, material: m })))
        if (allPending.length === 0) return null
        return (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200 dark:border-amber-900">
              <ClockIcon className="size-3.5 text-amber-600" />
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {t("materiel.view.pendingRequests")}
              </p>
              <span className="text-xs text-amber-600 dark:text-amber-400">({allPending.length})</span>
            </div>
            {allPending.map(({ demande, material }) => (
              <DemandeRow
                key={demande.id}
                demande={demande}
                material={material}
                onOpen={() => openDetail(material)}
              />
            ))}
          </div>
        )
      })()}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={searchInput}
          onValueChange={setSearchInput}
          placeholder={t("materiel.view.searchPlaceholder")}
          containerClassName="w-64"
        />
        <div className="flex gap-1.5 flex-wrap">
          {filterOptions.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "rounded-md border px-3 h-8 inline-flex items-center text-xs font-medium transition-colors",
                statusFilter === f.value
                  ? "bg-foreground text-background border-foreground"
                  : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0,1,2,3,4,5].map(i => <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <PackageIcon className="size-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium">{materials.length === 0 ? t("materiel.view.noArticles") : t("materiel.view.noResults")}</p>
            <p className="text-xs text-muted-foreground">
              {materials.length === 0
                ? t("materiel.view.noArticlesHint")
                : t("materiel.view.noResultsHint")
              }
            </p>
          </div>
          {canEditMateriel && materials.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-3.5" /> {t("materiel.view.addArticle")}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(m => (
            <MaterialCard key={m.id} material={m} onClick={() => openDetail(m)} />
          ))}
        </div>
      )}

      {canEditMateriel && <MaterialModal open={createOpen} onOpenChange={setCreateOpen} />}

      <MaterialDetailSheet
        material={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onDeleted={() => setSelected(null)}
      />
    </div>
  )
}
