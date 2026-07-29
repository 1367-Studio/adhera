"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
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
  reconciliations: { id: string; bankTransaction: { bankAccount: { accountName: string } } }[]
}

const PAGE_SIZE   = 25
const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

type Translator = ReturnType<typeof useTranslations>

function getStatusConfig(t: Translator) {
  return {
    PENDING:   { label: t("finances.incomeForm.status.pending"),   variant: "secondary" as const, icon: ClockIcon },
    PAID:      { label: t("finances.incomeForm.status.paid"),      variant: "default" as const,   icon: CheckCircleIcon },
    CANCELLED: { label: t("finances.incomeForm.status.cancelled"), variant: "destructive" as const, icon: XIcon },
  }
}

export function IncomesView() {
  const t = useTranslations()
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
      toast.success(t("finances.incomesView.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: IncomeInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("finances.incomesView.toasts.updated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("finances.incomesView.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const statusConfig = getStatusConfig(t)

  const columns: Column<Income>[] = [
    {
      key: "date",
      header: t("finances.incomesView.columns.date"),
      className: "w-28",
      cell: (i) => format(new Date(i.date), "dd/MM/yyyy", { locale: fr }),
    },
    {
      key: "description",
      header: t("finances.incomesView.columns.description"),
      cell: (i) => (
        <div>
          <p className="font-medium">{i.description || (i.membre ? `${i.membre.firstName} ${i.membre.lastName}` : "—")}</p>
          {(i.reconciliations.length > 0 || i.facturePaymentId) && (
            <div className="flex items-center gap-2 mt-0.5">
              {i.reconciliations.length > 0 && <span className="text-xs text-green-600 dark:text-green-400">{t("finances.incomesView.reconciled")}</span>}
              {i.facturePaymentId && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground" title={t("finances.incomesView.fromInvoiceTooltip")}>
                  <ReceiptIcon className="size-3" /> {t("finances.incomesView.fromInvoiceBadge")}
                </span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "compte",
      header: t("finances.incomesView.columns.compte"),
      className: "w-36",
      cell: (i) => i.reconciliations[0]?.bankTransaction.bankAccount.accountName ?? "—",
    },
    {
      key: "paymentMethod",
      header: t("finances.incomesView.columns.paymentMethod"),
      className: "w-36",
      cell: (i) => i.paymentMethod ?? "—",
    },
    {
      key: "amount",
      header: t("finances.incomesView.columns.amount"),
      className: "w-28 text-right",
      cell: (i) => <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">+{fmt(i.amount)}</span>,
    },
    {
      key: "status",
      header: t("finances.incomesView.columns.status"),
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
          { label: t("finances.incomesView.actions.edit"),  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(i) },
          {
            label: t("finances.incomesView.actions.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true,
            onClick: () => i.facturePaymentId
              ? toast.error(t("finances.incomesView.deleteFromInvoiceError"))
              : setDeleteTarget(i),
          },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.incomesView.title")}
        description={t("finances.incomesView.description")}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("common.add")}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative w-60">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("finances.incomesView.searchPlaceholder")}
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
          options={yearOptions.map(y => ({ value: String(y), label: t("finances.incomesView.exercise", { year: y }) }))}
          placeholder={t("finances.incomesView.allYears")}
          width="w-36"
        />

        <FilterSelect
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: "PENDING",   label: t("finances.incomeForm.status.pending")   },
            { value: "PAID",      label: t("finances.incomeForm.status.paid")      },
            { value: "CANCELLED", label: t("finances.incomeForm.status.cancelled") },
          ]}
          placeholder={t("finances.incomesView.allStatuses")}
        />
      </div>

      <DataTable
        columns={columns}
        data={incomes}
        loading={isLoading}
        keyExtractor={(i) => i.id}
        empty={t("finances.incomesView.noIncome")}
        pagination={result ? { page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit, onPageChange: setPage } : undefined}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("finances.incomesView.newTitle")} size="md" dismissable={false}>
        <IncomeForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createMutation.isPending} />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} title={t("finances.incomesView.editTitle")} size="md" dismissable={false}>
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
        title={t("finances.incomesView.deleteConfirmTitle")}
        description={deleteTarget?.description ?? t("finances.incomesView.deleteConfirmFallback", { amount: deleteTarget ? fmt(deleteTarget.amount) : "" })}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
