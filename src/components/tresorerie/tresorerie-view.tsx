"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { PlusIcon, PencilIcon, Trash2Icon, SearchIcon, XIcon, TrendingUpIcon, TrendingDownIcon } from "lucide-react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useTresorerie, useCreateEntry, useUpdateEntry, useDeleteEntry } from "@/hooks/use-tresorerie"
import type { TresorerieInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { TresorerieForm } from "@/components/tresorerie/tresorerie-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

type Entry = {
  id:          string
  type:        "ENTREE" | "SORTIE"
  amount:      string
  description: string
  date:        string
  category:    string | null
}

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)
const PAGE_SIZE   = 25

export function TresorerieView() {
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [yearFilter, setYearFilter]     = useState<number>(currentYear)
  const [typeFilter, setTypeFilter]     = useState<string>("")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Entry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const filters = {
    year:   yearFilter || undefined,
    type:   typeFilter || undefined,
    search: search     || undefined,
  }

  const { data: result, isLoading } = useTresorerie(page, PAGE_SIZE, filters)
  const entries  = (result?.data ?? []) as Entry[]
  const solde    = result?.solde    ?? 0
  const recettes = result?.recettes ?? 0
  const depenses = result?.depenses ?? 0

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation = useCreateEntry()
  const updateMutation = useUpdateEntry(editTarget?.id ?? "")
  const deleteMutation = useDeleteEntry()

  async function handleCreate(data: TresorerieInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Entrée enregistrée")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: TresorerieInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Entrée mise à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Entrée supprimée")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const columns: Column<Entry>[] = [
    {
      key: "type",
      header: "Type",
      className: "w-24",
      cell: (e) => e.type === "ENTREE"
        ? <Badge variant="default" className="bg-green-600 hover:bg-green-700"><TrendingUpIcon className="size-3 mr-1" />Entrée</Badge>
        : <Badge variant="destructive"><TrendingDownIcon className="size-3 mr-1" />Sortie</Badge>,
    },
    {
      key: "description",
      header: "Description",
      cell: (e) => (
        <div>
          <p className="font-medium">{e.description}</p>
          {e.category && <p className="text-xs text-muted-foreground">{e.category}</p>}
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      className: "w-28",
      cell: (e) => format(new Date(e.date), "dd/MM/yyyy", { locale: fr }),
    },
    {
      key: "amount",
      header: "Montant",
      className: "w-28 text-right",
      cell: (e) => (
        <span className={cn(
          "font-semibold tabular-nums",
          e.type === "ENTREE" ? "text-green-600 dark:text-green-400" : "text-destructive",
        )}>
          {e.type === "ENTREE" ? "+" : "−"}
          {parseFloat(e.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (e) => (
        <RowActions actions={[
          { label: "Modifier",  icon: <PencilIcon className="size-3.5" />, onClick: () => setEditTarget(e) },
          { label: "Supprimer", icon: <Trash2Icon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(e) },
        ]} />
      ),
    },
  ]

  const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const bilanAnnee = recettes - depenses

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trésorerie"
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={cn(
              "font-semibold",
              solde >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive",
            )}>
              Solde global : {fmt(solde)}
            </span>
            {yearFilter > 0 && (
              <span className="text-sm text-muted-foreground">
                {yearFilter} · Recettes&nbsp;
                <span className="text-green-600 dark:text-green-400 font-medium">+{fmt(recettes)}</span>
                &nbsp;· Dépenses&nbsp;
                <span className="text-destructive font-medium">−{fmt(depenses)}</span>
                &nbsp;· Bilan&nbsp;
                <span className={cn("font-semibold", bilanAnnee >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                  {bilanAnnee >= 0 ? "+" : ""}{fmt(bilanAnnee)}
                </span>
              </span>
            )}
          </div>
        }
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            Ajouter
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {/* Search */}
        <div className="relative w-60">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher…"
            value={searchInput}
            onChange={e => handleSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-8 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                if (debounceRef.current) clearTimeout(debounceRef.current)
                setSearchInput("")
                setSearch("")
                setPage(1)
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>

        {/* Year */}
        <Select
          value={String(yearFilter)}
          onValueChange={v => { if (v !== null) { setYearFilter(parseInt(v)); setPage(1) } }}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Type */}
        <Select
          value={typeFilter || "all"}
          onValueChange={v => { setTypeFilter(v === "all" || v === null ? "" : v); setPage(1) }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Tous" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="ENTREE">Entrées</SelectItem>
            <SelectItem value="SORTIE">Sorties</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={entries}
        loading={isLoading}
        keyExtractor={(e) => e.id}
        empty="Aucune écriture enregistrée"
        pagination={result ? {
          page:         result.page,
          totalPages:   result.totalPages,
          total:        result.total,
          limit:        result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />

      {/* Create */}
      <Modal open={createOpen} onOpenChange={setCreateOpen} title="Nouvelle écriture" size="md" dismissable={false}>
        <TresorerieForm
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit */}
      <Modal
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title="Modifier l'écriture"
        size="md"
        dismissable={false}
      >
        <TresorerieForm
          defaultValues={editTarget ? {
            type:        editTarget.type,
            amount:      parseFloat(editTarget.amount),
            description: editTarget.description,
            date:        editTarget.date.split("T")[0],
            category:    editTarget.category ?? "",
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      {/* Delete */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Supprimer cette écriture ?"
        description={deleteTarget?.description ?? ""}
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
