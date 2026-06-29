"use client"

import { useState, useMemo, useEffect } from "react"
import {
  PlusIcon, SearchIcon, PackageIcon,
  MapPinIcon, ClockIcon, CheckIcon, XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useMateriel, useConfirmLoan, useRefuseLoan, type Material, type MaterialStatus, type PendingDemande } from "@/hooks/use-materiel"
import { MaterialModal } from "@/components/materiel/material-modal"
import { MaterialDetailSheet } from "@/components/materiel/material-detail-sheet"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const STATUS_CONFIG: Record<MaterialStatus, { label: string; dot: string; pill: string }> = {
  DISPONIBLE:     { label: "Disponible",     dot: "bg-green-500", pill: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  EN_USE:         { label: "En utilisation", dot: "bg-blue-500",  pill: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  EN_MAINTENANCE: { label: "Maintenance",    dot: "bg-amber-400", pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  HORS_SERVICE:   { label: "Hors service",   dot: "bg-gray-400",  pill: "bg-muted text-muted-foreground" },
  PERDU:          { label: "Perdu",          dot: "bg-red-500",   pill: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
}

const FILTER_OPTIONS = [
  { value: "ALL",           label: "Tous" },
  { value: "DISPONIBLE",    label: "Disponibles" },
  { value: "EN_USE",        label: "En utilisation" },
  { value: "EN_MAINTENANCE",label: "Maintenance" },
  { value: "HORS_SERVICE",  label: "Hors service" },
  { value: "PERDU",         label: "Perdus" },
]

function DemandeRow({ demande, material, onOpen }: { demande: PendingDemande; material: Material; onOpen: () => void }) {
  const confirmLoan = useConfirmLoan(material.id)
  const refuseLoan  = useRefuseLoan(material.id)
  const busy        = confirmLoan.isPending || refuseLoan.isPending
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
          {demande.expectedReturnAt && ` · retour prévu le ${new Date(demande.expectedReturnAt).toLocaleDateString("fr-FR")}`}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            try { await confirmLoan.mutateAsync(demande.id); toast.success("Emprunt confirmé") }
            catch (err) { toast.error(err instanceof Error ? err.message : "Erreur") }
          }}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 transition-colors disabled:opacity-40"
        >
          <CheckIcon className="size-3" /> Accepter
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            try { await refuseLoan.mutateAsync(demande.id); toast.success("Demande refusée") }
            catch (err) { toast.error(err instanceof Error ? err.message : "Erreur") }
          }}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 transition-colors disabled:opacity-40"
        >
          <XIcon className="size-3" /> Refuser
        </button>
      </div>
    </div>
  )
}

function MaterialCard({ material, onClick }: { material: Material; onClick: () => void }) {
  const allLoaned = material.loanedQty > 0 && material.availableQty === 0
  const cfg = (material.status === "DISPONIBLE" && allLoaned)
    ? STATUS_CONFIG.EN_USE
    : STATUS_CONFIG[material.status]

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border bg-card hover:bg-muted/30 transition-colors p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{material.name}</p>
          {material.category && <p className="text-xs text-muted-foreground truncate">{material.category}</p>}
        </div>
        <span className={cn("shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full", cfg.pill)}>
          {cfg.label}
        </span>
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
          {material.pendingDemandesCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <ClockIcon className="size-2.5" />
              {material.pendingDemandesCount}
            </span>
          )}
          <span className={cn(
            "shrink-0 font-medium",
            material.availableQty === 0 ? "text-red-600" : material.loanedQty > 0 ? "text-amber-600" : "text-green-600",
          )}>
            {material.availableQty}/{material.quantity} disponibles
          </span>
        </div>
      </div>
    </button>
  )
}

export function MaterielView() {
  const [searchInput,  setSearchInput]  = useState("")
  const [search,       setSearch]       = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [createOpen,   setCreateOpen]   = useState(false)
  const [selected,     setSelected]     = useState<Material | null>(null)
  const [sheetOpen,    setSheetOpen]    = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data: materials = [], isLoading } = useMateriel(search || undefined)

  const filtered = useMemo(() => {
    return materials.filter(m => {
      if (statusFilter === "ALL")         return true
      if (statusFilter === "EN_USE")      return m.status === "EN_USE" || m.loanedQty > 0
      if (statusFilter === "DISPONIBLE")  return m.status === "DISPONIBLE" && m.availableQty > 0
      return m.status === statusFilter
    })
  }, [materials, statusFilter])

  const stats = useMemo(() => ({
    total:       materials.length,
    disponible:  materials.filter(m => m.status === "DISPONIBLE").length,
    enPret:      materials.filter(m => m.loanedQty > 0).length,
    maintenance: materials.filter(m => m.status === "EN_MAINTENANCE").length,
  }), [materials])

  function openDetail(m: Material) {
    setSelected(m)
    setSheetOpen(true)
  }

  return (
    <div className="space-y-6 py-4">
      <PageHeader
        title="Matériel"
        description="Inventaire et gestion des emprunts"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" /> Ajouter
          </Button>
        }
      />

      {/* Stats */}
      {!isLoading && materials.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Articles",    value: stats.total,       color: "text-foreground" },
            { label: "Disponibles", value: stats.disponible,  color: "text-green-600"  },
            { label: "En prêt",     value: stats.enPret,      color: "text-blue-600"   },
            { label: "Maintenance", value: stats.maintenance, color: "text-amber-600"  },
          ].map(s => (
            <div key={s.label} className="rounded-xl border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pending demandes */}
      {(() => {
        const allPending = materials.flatMap(m => (m.pendingDemandes ?? []).map(d => ({ demande: d, material: m })))
        if (allPending.length === 0) return null
        return (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200 dark:border-amber-900">
              <ClockIcon className="size-3.5 text-amber-600" />
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Demandes en attente
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
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Rechercher…"
            className="pl-8 h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
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
          {[0,1,2,3,4,5].map(i => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <PackageIcon className="size-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium">{materials.length === 0 ? "Aucun article" : "Aucun résultat"}</p>
            <p className="text-xs text-muted-foreground">
              {materials.length === 0
                ? "Ajoutez votre premier article pour commencer."
                : "Essayez d'autres filtres ou termes de recherche."
              }
            </p>
          </div>
          {materials.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-3.5" /> Ajouter un article
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

      <MaterialModal open={createOpen} onOpenChange={setCreateOpen} />

      <MaterialDetailSheet
        material={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onDeleted={() => setSelected(null)}
      />
    </div>
  )
}
