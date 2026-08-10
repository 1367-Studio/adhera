"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { LinkIcon, MinusIcon, TrendUpIcon, TrendDownIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useBankTransactions, useReconcile, useReactivateTransaction } from "@/hooks/use-bank-transactions"
import { useBankAccounts } from "@/hooks/use-bank-accounts"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FilterSelect } from "@/components/ui/filter-select"
import { IncomeForm } from "@/components/finances/income-form"
import { ExpenseForm } from "@/components/finances/expense-form"
import { ReconciliationMatchModal } from "@/components/finances/reconciliation-match-modal"
import { cn } from "@/lib/utils"
import type { IncomeInput, ExpenseInput } from "@/lib/schemas"
import { useCreateIncome } from "@/hooks/use-incomes"
import { useCreateExpense } from "@/hooks/use-expenses"

type BankTx = {
  id:              string
  transactionDate: string
  label:           string
  amount:          string
  type:            "CREDIT" | "DEBIT"
  status:          "UNMATCHED" | "MATCHED" | "PENDING" | "IGNORED" | "DUPLICATE"
  bankAccount:     { accountName: string; bankName: string }
  reconciliations: Array<{
    income?:  { id: string; description: string | null; amount: string; membre?: { firstName: string; lastName: string } | null } | null
    expense?: { id: string; description: string | null; vendor: string | null; amount: string } | null
  }>
}

const PAGE_SIZE = 50

type Translator = ReturnType<typeof useTranslations>

function getStatusFilters(t: Translator) {
  return [
    { value: "all",       label: t("finances.reconciliationView.statusFilters.all") },
    { value: "UNMATCHED", label: t("finances.reconciliationView.statusFilters.unmatched") },
    { value: "MATCHED",   label: t("finances.reconciliationView.statusFilters.matched") },
    { value: "IGNORED",   label: t("finances.reconciliationView.statusFilters.ignored") },
    { value: "DUPLICATE", label: t("finances.reconciliationView.statusFilters.duplicate") },
  ]
}

function getStatusConfig(t: Translator): Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    UNMATCHED: { label: t("finances.reconciliationView.status.unmatched"), variant: "secondary" },
    MATCHED:   { label: t("finances.reconciliationView.status.matched"),   variant: "default"   },
    PENDING:   { label: t("finances.reconciliationView.status.pending"),   variant: "outline"   },
    IGNORED:   { label: t("finances.reconciliationView.status.ignored"),   variant: "outline"   },
    DUPLICATE: { label: t("finances.reconciliationView.status.duplicate"), variant: "destructive" },
  }
}

export function ReconciliationView() {
  const t = useTranslations()
  const [page, setPage]               = useState(1)
  const [statusFilter, setStatusFilter] = useState("UNMATCHED")
  const [accountFilter, setAccountFilter] = useState("")
  const [matchModal, setMatchModal]   = useState<BankTx | null>(null)
  const [incomeModal, setIncomeModal] = useState<BankTx | null>(null)
  const [expenseModal, setExpenseModal] = useState<BankTx | null>(null)

  const { data: accounts = [] } = useBankAccounts()

  const filters = {
    ...(statusFilter && statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(accountFilter ? { bankAccountId: accountFilter } : {}),
  }

  const { data: result, isLoading } = useBankTransactions(page, PAGE_SIZE, filters)
  const transactions = (result?.data ?? []) as BankTx[]

  const reconcileMutation     = useReconcile()
  const reactivateMutation    = useReactivateTransaction()
  const createIncomeMutation  = useCreateIncome()
  const createExpenseMutation = useCreateExpense()

  async function handleIgnore(tx: BankTx) {
    try {
      await reconcileMutation.mutateAsync({ bankTransactionId: tx.id, action: "IGNORE" })
      toast.success(t("finances.reconciliationView.toasts.ignored"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDuplicate(tx: BankTx) {
    try {
      await reconcileMutation.mutateAsync({ bankTransactionId: tx.id, action: "DUPLICATE" })
      toast.success(t("finances.reconciliationView.toasts.markedDuplicate"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleReactivate(tx: BankTx) {
    try {
      await reactivateMutation.mutateAsync(tx.id)
      toast.success(t("finances.reconciliationView.toasts.reactivated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUnmatch(tx: BankTx) {
    try {
      await reconcileMutation.mutateAsync({ bankTransactionId: tx.id, action: "UNMATCH" })
      toast.success(t("finances.reconciliationView.toasts.unmatched"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCreateIncome(data: IncomeInput, tx: BankTx) {
    try {
      const income = await createIncomeMutation.mutateAsync(data)
      await reconcileMutation.mutateAsync({ bankTransactionId: tx.id, action: "MATCH", incomeId: income.id })
      toast.success(t("finances.reconciliationView.toasts.incomeCreated"))
      setIncomeModal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCreateExpense(data: ExpenseInput, tx: BankTx) {
    try {
      const expense = await createExpenseMutation.mutateAsync(data)
      await reconcileMutation.mutateAsync({ bankTransactionId: tx.id, action: "MATCH", expenseId: expense.id })
      toast.success(t("finances.reconciliationView.toasts.expenseCreated"))
      setExpenseModal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const statusFilters = getStatusFilters(t)
  const statusConfig  = getStatusConfig(t)

  const columns: Column<BankTx>[] = [
    {
      key: "date",
      header: t("finances.reconciliationView.columns.date"),
      className: "w-28",
      cell: (tx) => format(new Date(tx.transactionDate), "dd/MM/yyyy", { locale: fr }),
    },
    {
      key: "label",
      header: t("finances.reconciliationView.columns.label"),
      cell: (tx) => (
        <div>
          <p className="font-medium text-sm">{tx.label}</p>
          <p className="text-xs text-muted-foreground">{tx.bankAccount.accountName}</p>
          {tx.reconciliations[0] && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
              → {tx.reconciliations[0].income?.description || tx.reconciliations[0].income?.membre?.lastName || tx.reconciliations[0].expense?.description || tx.reconciliations[0].expense?.vendor || t("finances.reconciliationView.reconciledFallback")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: t("finances.reconciliationView.columns.amount"),
      className: "w-32 text-right",
      cell: (tx) => (
        <span className={cn("font-semibold tabular-nums flex items-center justify-end gap-1", tx.type === "CREDIT" ? "text-green-600 dark:text-green-400" : "text-destructive")}>
          {tx.type === "CREDIT" ? <TrendUpIcon className="size-3.5" /> : <TrendDownIcon className="size-3.5" />}
          {tx.type === "CREDIT" ? "+" : "−"}{fmt(tx.amount)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("finances.reconciliationView.columns.status"),
      className: "w-28",
      cell: (tx) => {
        const cfg = statusConfig[tx.status] ?? { label: tx.status, variant: "secondary" as const }
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>
      },
    },
    {
      key: "actions",
      header: t("finances.reconciliationView.columns.actions"),
      className: "w-52",
      hideInCard: true,
      cell: (tx) => {
        if (tx.status === "MATCHED") {
          return (
            <Button
              size="xs" variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => handleUnmatch(tx)}
              title={t("finances.reconciliationView.actions.unmatchTitle")}
            >
              <ArrowCounterClockwiseIcon className="size-3 mr-1" />{t("finances.reconciliationView.actions.unmatch")}
            </Button>
          )
        }
        if (tx.status === "IGNORED" || tx.status === "DUPLICATE") {
          return (
            <Button
              size="xs" variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => handleReactivate(tx)}
              title={t("finances.reconciliationView.actions.reactivateTitle")}
            >
              <ArrowCounterClockwiseIcon className="size-3 mr-1" />{t("finances.reconciliationView.actions.reactivate")}
            </Button>
          )
        }
        return (
          <div className="flex items-center gap-1 flex-wrap">
            <Button size="xs" variant="outline" onClick={() => setMatchModal(tx)}>
              <LinkIcon className="size-3 mr-1" />{t("finances.reconciliationView.actions.match")}
            </Button>
            {tx.type === "CREDIT" ? (
              <Button size="xs" variant="outline" className="text-green-700 dark:text-green-400" onClick={() => setIncomeModal(tx)}>
                + {t("finances.reconciliationView.actions.addIncome")}
              </Button>
            ) : (
              <Button size="xs" variant="outline" className="text-destructive" onClick={() => setExpenseModal(tx)}>
                + {t("finances.reconciliationView.actions.addExpense")}
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => handleIgnore(tx)} title={t("finances.reconciliationView.actions.ignore")}>
              <MinusIcon className="size-3.5" />
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.reconciliationView.title")}
        description={t("finances.reconciliationView.description")}
      />

      <div className="flex flex-wrap gap-2">
        <div className="flex h-9 rounded-md border overflow-hidden">
          {statusFilters.map(f => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(1) }}
              className={cn(
                "px-3 text-sm transition-colors",
                statusFilter === f.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {(accounts as { id: string; accountName: string }[]).length > 1 && (
          <FilterSelect
            value={accountFilter}
            onValueChange={v => { setAccountFilter(v); setPage(1) }}
            options={(accounts as { id: string; accountName: string }[]).map(a => ({ value: a.id, label: a.accountName }))}
            placeholder={t("finances.reconciliationView.allAccounts")}
            width="w-48"
          />
        )}
      </div>

      <DataTable
        columns={columns}
        data={transactions}
        loading={isLoading}
        keyExtractor={(tx) => tx.id}
        empty={t("finances.reconciliationView.noTransactions")}
        pagination={result ? { page: result.page, totalPages: result.totalPages, total: result.total, limit: result.limit, onPageChange: setPage } : undefined}
      />

      {/* Match existing modal */}
      {matchModal && (
        <ReconciliationMatchModal
          transaction={matchModal}
          open={!!matchModal}
          onOpenChange={(o) => !o && setMatchModal(null)}
          onMatch={async ({ incomeId, expenseId }) => {
            await reconcileMutation.mutateAsync({ bankTransactionId: matchModal.id, action: "MATCH", incomeId, expenseId })
            toast.success(t("finances.reconciliationView.toasts.matched"))
            setMatchModal(null)
          }}
        />
      )}

      {/* Create income from transaction */}
      {incomeModal && (
        <Modal open={!!incomeModal} onOpenChange={(o) => !o && setIncomeModal(null)} title={t("finances.reconciliationView.createIncomeTitle")} size="md" dismissable={false}>
          <p className="text-sm text-muted-foreground mb-4">{t("finances.reconciliationView.transactionLabel")} <strong>{incomeModal.label}</strong> · +{fmt(incomeModal.amount)}</p>
          <IncomeForm
            defaultValues={{
              amount: parseFloat(incomeModal.amount),
              date:   incomeModal.transactionDate.split("T")[0],
              status: "PAID",
              source: "BANK_IMPORT",
            }}
            onSubmit={(data) => handleCreateIncome(data, incomeModal)}
            onCancel={() => setIncomeModal(null)}
            loading={createIncomeMutation.isPending || reconcileMutation.isPending}
          />
        </Modal>
      )}

      {/* Create expense from transaction */}
      {expenseModal && (
        <Modal open={!!expenseModal} onOpenChange={(o) => !o && setExpenseModal(null)} title={t("finances.reconciliationView.createExpenseTitle")} size="md" dismissable={false}>
          <p className="text-sm text-muted-foreground mb-4">{t("finances.reconciliationView.transactionLabel")} <strong>{expenseModal.label}</strong> · −{fmt(expenseModal.amount)}</p>
          <ExpenseForm
            defaultValues={{
              amount: parseFloat(expenseModal.amount),
              date:   expenseModal.transactionDate.split("T")[0],
              status: "VALIDATED",
            }}
            onSubmit={(data) => handleCreateExpense(data, expenseModal)}
            onCancel={() => setExpenseModal(null)}
            loading={createExpenseMutation.isPending || reconcileMutation.isPending}
          />
        </Modal>
      )}
    </div>
  )
}
