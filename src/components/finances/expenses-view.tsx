"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { PlusIcon, PencilSimpleIcon, TrashIcon, MagnifyingGlassIcon, XIcon, PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useExpenses, useCreateExpense, useUpdateExpense, useDeleteExpense } from "@/hooks/use-expenses"
import type { ExpenseInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { FilterSelect } from "@/components/ui/filter-select"
import { ExpenseForm } from "@/components/finances/expense-form"

type Expense = {
  id:          string
  amount:      string
  date:        string
  description: string | null
  vendor:      string | null
  status:      "DRAFT" | "VALIDATED" | "CANCELLED"
  receiptUrl:  string | null
  internalNote: string | null
  category:    { name: string } | null
  reconciliations: { id: string }[]
}

const PAGE_SIZE   = 25
const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

const statusConfig = {
  DRAFT:     { label: "Brouillon", variant: "secondary" as const },
  VALIDATED: { label: "Validée",   variant: "default"   as const },
  CANCELLED: { label: "Annulée",   variant: "destructive" as const },
}

export function ExpensesView() {
  const [page, setPage]                 = useState(1)
  const [yearFilter, setYearFilter]     = useState(String(currentYear))
  const [statusFilter, setStatusFilter] = useState("")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Expense | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null)

  const filters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(yearFilter ? { dateFrom: `${yearFilter}-01-01`, dateTo: `${yearFilter}-12-31` } : {}),
  }

  const { data: result, isLoading } = useExpenses(page, PAGE_SIZE, filters)
  const expenses = (result?.data ?? []) as Expense[]

  const createMutation = useCreateExpense()
  const updateMutation = useUpdateExpense(editTarget?.id ?? "")
  const deleteMutation = useDeleteExpense()

  async function handleCreate(data: ExpenseInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Dépense enregistrée")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: ExpenseInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Dépense mise à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Dépense supprimée")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const columns: Column<Expense>[] = [
    {
      key: "date",
      header: "Date",
      className: "w-28",
      cell: (e) => format(new Date(e.date), "dd/MM/yyyy", { locale: fr }),
    },
    {
      key: "description",
      header: "Description",
      cell: (e) => (
        <div>
          <p className="font-medium">{e.description || e.vendor || "—"}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {e.vendor && e.description && <span className="text-xs text-muted-foreground">{e.vendor}</span>}
            {e.category && <span className="text-xs text-muted-foreground">{e.category.name}</span>}
            {e.reconciliations.length > 0 && <span className="text-xs text-green-600 dark:text-green-400">· Concilié</span>}
          </div>
        </div>
      ),
    },
    {
      key: "receipt",
      header: "Justificatif",
      className: "w-28",
      cell: (e) => e.receiptUrl
        ? <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline"><PaperclipIcon className="size-3" />Voir</a>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      key: "amount",
      header: "Montant",
      className: "w-28 text-right",
      cell: (e) => <span className="font-semibold tabular-nums text-destructive">−{fmt(e.amount)}</span>,
    },
    {
      key: "status",
      header: "Statut",
      className: "w-28",
      cell: (e) => {
        const cfg = statusConfig[e.status]
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (e) => (
        <RowActions actions={[
          { label: "Modifier",  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(e) },
          { label: "Supprimer", icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(e) },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dépenses"
        description="Toutes les sorties d'argent de l'association."
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            Ajouter
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <FilterSelect
          value={yearFilter}
          onValueChange={v => { setYearFilter(v); setPage(1) }}
          options={yearOptions.map(y => ({ value: String(y), label: String(y) }))}
          placeholder="Toutes années"
          width="w-32"
        />

        <FilterSelect
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: "DRAFT",     label: "Brouillon" },
            { value: "VALIDATED", label: "Validée" },
            { value: "CANCELLED", label: "Annulée" },
          ]}
          placeholder="Tous statuts"
        />
      </div>

      <DataTable
        columns={columns}
        data={expenses}
        loading={isLoading}
        keyExtractor={(e) => e.id}
        empty="Aucune dépense enregistrée"
        pagination={result ? { page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit, onPageChange: setPage } : undefined}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="Nouvelle dépense" size="md" dismissable={false}>
        <ExpenseForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createMutation.isPending} />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} title="Modifier la dépense" size="md" dismissable={false}>
        <ExpenseForm
          defaultValues={editTarget ? {
            amount:       parseFloat(editTarget.amount),
            date:         editTarget.date.split("T")[0],
            description:  editTarget.description  ?? "",
            vendor:       editTarget.vendor        ?? "",
            status:       editTarget.status,
            receiptUrl:   editTarget.receiptUrl    ?? "",
            internalNote: editTarget.internalNote  ?? "",
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer cette dépense ?"
        description={deleteTarget?.description ?? deleteTarget?.vendor ?? ""}
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
