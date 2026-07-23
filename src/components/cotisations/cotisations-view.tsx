"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { PlusIcon, PencilSimpleIcon, TrashIcon, MagnifyingGlassIcon, XIcon, DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useCotisationsPaginated, useCreateCotisation, useUpdateCotisation, useDeleteCotisation } from "@/hooks/use-cotisations"
import { useQuery } from "@tanstack/react-query"
import type { CotisationInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CotisationForm } from "@/components/cotisations/cotisation-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BASE_PATH } from "@/lib/env";

type Cotisation = {
  id:     string
  year:   number
  amount: string
  status: "EN_ATTENTE" | "PAYE" | "EXONERE"
  paidAt: string | null
  note:   string | null
  membre: { id: string; firstName: string; lastName: string; email: string | null }
}

type MembreOption = { id: string; firstName: string; lastName: string }

const statusBadge: Record<Cotisation["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  EN_ATTENTE: { label: "En attente", variant: "secondary"   },
  PAYE:       { label: "Payée",      variant: "default"     },
  EXONERE:    { label: "Exonérée",   variant: "outline"     },
}

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

const PAGE_SIZE = 25

export function CotisationsView() {
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [yearFilter, setYearFilter]     = useState<number>(currentYear)
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Cotisation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Cotisation | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const filters = {
    year:   yearFilter || undefined,
    status: statusFilter || undefined,
    search: search       || undefined,
  }

  const { data: result, isLoading } = useCotisationsPaginated(page, PAGE_SIZE, filters)
  const cotisations = (result?.data ?? []) as Cotisation[]
  const totalPaye   = result?.totalPaye ?? 0

  // Load all active membres for the create form
  const { data: membres = [] } = useQuery<MembreOption[]>({
    queryKey: ["membres", "all"],
    queryFn:  async () => {
      const res = await fetch("/api/membres")
      return res.ok ? res.json() : []
    },
  })

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation = useCreateCotisation()
  const updateMutation = useUpdateCotisation(editTarget?.id ?? "")
  const deleteMutation = useDeleteCotisation()

  async function handleCreate(data: CotisationInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Cotisation enregistrée")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: CotisationInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Cotisation mise à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Cotisation supprimée")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const columns: Column<Cotisation>[] = [
    {
      key: "membre",
      header: "Membre",
      cell: (c) => (
        <div>
          <p className="font-medium">{c.membre.lastName} {c.membre.firstName}</p>
          {c.membre.email && <p className="text-xs text-muted-foreground">{c.membre.email}</p>}
        </div>
      ),
    },
    {
      key: "year",
      header: "Année",
      cell: (c) => <span className="font-mono text-sm">{c.year}</span>,
      className: "w-20",
    },
    {
      key: "amount",
      header: "Montant",
      cell: (c) => (
        <span className="font-medium tabular-nums">
          {parseFloat(c.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      ),
      className: "w-28",
    },
    {
      key: "status",
      header: "Statut",
      cell: (c) => {
        const s = statusBadge[c.status]
        return <Badge variant={s.variant}>{s.label}</Badge>
      },
      className: "w-28",
    },
    {
      key: "paidAt",
      header: "Payé le",
      cell: (c) => c.paidAt
        ? format(new Date(c.paidAt), "dd/MM/yyyy", { locale: fr })
        : <span className="text-muted-foreground text-xs">—</span>,
      className: "w-28",
      hideInCard: true,
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (c) => {
        const actions = [
          { label: "Modifier", icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(c) },
          ...(c.status === "PAYE" ? [{
            label:   "Déclaration",
            icon:    <DownloadSimpleIcon className="size-3.5" />,
            onClick: () => window.open(`${BASE_PATH}/api/membres/${c.membre.id}/cotisations/${c.id}/declaration`, "_blank"),
          }] : []),
          { label: "Supprimer", icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(c) },
        ]
        return <RowActions actions={actions} />
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cotisations"
        description={`${result?.total ?? 0} cotisation${(result?.total ?? 0) !== 1 ? "s" : ""}${totalPaye > 0 ? ` · ${totalPaye.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} encaissé` : ""}`}
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
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher un membre…"
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

        {/* Year filter */}
        <Select
          value={String(yearFilter)}
          onValueChange={v => { if (v !== null) { setYearFilter(parseInt(v)); setPage(1) } }}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select
          value={statusFilter || "all"}
          onValueChange={v => { setStatusFilter(v === "all" || v === null ? "" : v); setPage(1) }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Tous les statuts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="EN_ATTENTE">En attente</SelectItem>
            <SelectItem value="PAYE">Payées</SelectItem>
            <SelectItem value="EXONERE">Exonérées</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={cotisations}
        loading={isLoading}
        keyExtractor={(c) => c.id}
        empty={search ? `Aucun résultat pour « ${search} »` : "Aucune cotisation enregistrée"}
        pagination={result ? {
          page:         result.page,
          totalPages:   result.totalPages,
          total:        result.total,
          limit:        result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />

      {/* Create */}
      <Modal open={createOpen} onOpenChange={setCreateOpen} title="Ajouter une cotisation" size="lg" dismissable={false}>
        <CotisationForm
          membres={membres}
          defaultValues={{ year: yearFilter }}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit */}
      <Modal
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title="Modifier la cotisation"
        size="lg"
        dismissable={false}
      >
        <CotisationForm
          membres={membres}
          editMode
          defaultValues={editTarget ? {
            membreId: editTarget.membre.id,
            year:     editTarget.year,
            amount:   parseFloat(editTarget.amount),
            status:   editTarget.status,
            paidAt:   editTarget.paidAt ? editTarget.paidAt.split("T")[0] : "",
            note:     editTarget.note ?? "",
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
        title="Supprimer cette cotisation ?"
        description={deleteTarget
          ? `Cotisation ${deleteTarget.year} de ${deleteTarget.membre.lastName} ${deleteTarget.membre.firstName}.`
          : ""}
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
