"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { PlusIcon, PencilSimpleIcon, TrashIcon, MagnifyingGlassIcon, XIcon, TrendUpIcon, CheckCircleIcon, ClockIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useIncomes, useCreateIncome, useUpdateIncome, useDeleteIncome } from "@/hooks/use-incomes"
import { useFinanceCategories } from "@/hooks/use-finance-categories"
import type { IncomeInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { FilterSelect } from "@/components/ui/filter-select"
import { IncomeForm } from "@/components/finances/income-form"
import { cn } from "@/lib/utils"

type Income = {
  id:          string
  amount:      string
  date:        string
  description: string | null
  status:      "PENDING" | "PAID" | "CANCELLED"
  source:      string
  reference:   string | null
  paymentMethod: string | null
  facturePaymentId: string | null
  category:    { name: string } | null
  membre:      { firstName: string; lastName: string } | null
  reconciliations: { id: string }[]
}

const PAGE_SIZE   = 25
const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

const statusConfig = {
  PENDING:   { label: "En attente", variant: "secondary" as const, icon: ClockIcon },
  PAID:      { label: "Payé",       variant: "default" as const,   icon: CheckCircleIcon },
  CANCELLED: { label: "Annulé",     variant: "destructive" as const, icon: XIcon },
}

export function IncomesView() {
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [yearFilter, setYearFilter]     = useState(String(currentYear))
  const [statusFilter, setStatusFilter] = useState("")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Income | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Income | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const { data: categories = [] } = useFinanceCategories("INCOME")

  const filters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(yearFilter ? {
      dateFrom: `${yearFilter}-01-01`,
      dateTo:   `${yearFilter}-12-31`,
    } : {}),
  }

  const { data: result, isLoading } = useIncomes(page, PAGE_SIZE, filters)
  const incomes = (result?.data ?? []) as Income[]

  const createMutation = useCreateIncome()
  const updateMutation = useUpdateIncome(editTarget?.id ?? "")
  const deleteMutation = useDeleteIncome()

  async function handleCreate(data: IncomeInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Recette enregistrée")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: IncomeInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Recette mise à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Recette supprimée")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const columns: Column<Income>[] = [
    {
      key: "date",
      header: "Date",
      className: "w-28",
      cell: (i) => format(new Date(i.date), "dd/MM/yyyy", { locale: fr }),
    },
    {
      key: "description",
      header: "Description",
      cell: (i) => (
        <div>
          <p className="font-medium">{i.description || (i.membre ? `${i.membre.firstName} ${i.membre.lastName}` : "—")}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {i.category && <span className="text-xs text-muted-foreground">{i.category.name}</span>}
            {i.paymentMethod && <span className="text-xs text-muted-foreground">· {i.paymentMethod}</span>}
            {i.reconciliations.length > 0 && <span className="text-xs text-green-600 dark:text-green-400">· Concilié</span>}
            {i.facturePaymentId && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground" title="Générée automatiquement depuis le paiement d'une facture — modifiable uniquement depuis Factures">
                <ReceiptIcon className="size-3" /> Depuis une facture
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Montant",
      className: "w-28 text-right",
      cell: (i) => <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">+{fmt(i.amount)}</span>,
    },
    {
      key: "status",
      header: "Statut",
      className: "w-28",
      cell: (i) => {
        const cfg = statusConfig[i.status]
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (i) => (
        <RowActions actions={[
          { label: "Modifier",  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(i) },
          {
            label: "Supprimer", icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true,
            onClick: () => i.facturePaymentId
              ? toast.error("Cette recette vient d'une facture — supprimez plutôt le paiement depuis Factures.")
              : setDeleteTarget(i),
          },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recettes"
        description="Toutes les entrées d'argent de l'association."
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            Ajouter
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative w-60">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher…"
            value={searchInput}
            onChange={e => {
              setSearchInput(e.target.value)
              if (debounceRef.current) clearTimeout(debounceRef.current)
              debounceRef.current = setTimeout(() => { setSearch(e.target.value); setPage(1) }, 300)
            }}
            className="w-full rounded-md border border-input bg-background pl-9 pr-8 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {searchInput && (
            <button type="button" onClick={() => { setSearchInput(""); setSearch(""); setPage(1) }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>

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
            { value: "PENDING",   label: "En attente" },
            { value: "PAID",      label: "Payé" },
            { value: "CANCELLED", label: "Annulé" },
          ]}
          placeholder="Tous statuts"
        />
      </div>

      <DataTable
        columns={columns}
        data={incomes}
        loading={isLoading}
        keyExtractor={(i) => i.id}
        empty="Aucune recette enregistrée"
        pagination={result ? { page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit, onPageChange: setPage } : undefined}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="Nouvelle recette" size="md" dismissable={false}>
        <IncomeForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createMutation.isPending} />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} title="Modifier la recette" size="md" dismissable={false}>
        <IncomeForm
          defaultValues={editTarget ? {
            amount:        parseFloat(editTarget.amount),
            date:          editTarget.date.split("T")[0],
            description:   editTarget.description ?? "",
            status:        editTarget.status,
            source:        editTarget.source as "MANUAL" | "STRIPE" | "BANK_IMPORT",
            reference:     editTarget.reference ?? "",
            paymentMethod: editTarget.paymentMethod ?? "",
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
          locked={!!editTarget?.facturePaymentId}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer cette recette ?"
        description={deleteTarget?.description ?? `Recette de ${deleteTarget ? fmt(deleteTarget.amount) : ""}`}
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
