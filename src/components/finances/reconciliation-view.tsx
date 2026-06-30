"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { LinkIcon, MinusIcon, TrendingUpIcon, TrendingDownIcon, RotateCcwIcon } from "lucide-react"
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

const STATUS_FILTERS = [
  { value: "all",       label: "Tous" },
  { value: "UNMATCHED", label: "Non conciliés" },
  { value: "MATCHED",   label: "Conciliés" },
  { value: "IGNORED",   label: "Ignorés" },
  { value: "DUPLICATE", label: "Doublons" },
]

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  UNMATCHED: { label: "Non concilié", variant: "secondary" },
  MATCHED:   { label: "Concilié",     variant: "default"   },
  PENDING:   { label: "En attente",   variant: "outline"   },
  IGNORED:   { label: "Ignoré",       variant: "outline"   },
  DUPLICATE: { label: "Doublon",      variant: "destructive" },
}

const PAGE_SIZE = 50

export function ReconciliationView() {
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
      toast.success("Transaction ignorée")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDuplicate(tx: BankTx) {
    try {
      await reconcileMutation.mutateAsync({ bankTransactionId: tx.id, action: "DUPLICATE" })
      toast.success("Marqué comme doublon")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleReactivate(tx: BankTx) {
    try {
      await reactivateMutation.mutateAsync(tx.id)
      toast.success("Transaction remise en file d'attente")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCreateIncome(data: IncomeInput, tx: BankTx) {
    try {
      const income = await createIncomeMutation.mutateAsync(data)
      await reconcileMutation.mutateAsync({ bankTransactionId: tx.id, action: "MATCH", incomeId: income.id })
      toast.success("Recette créée et conciliée")
      setIncomeModal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCreateExpense(data: ExpenseInput, tx: BankTx) {
    try {
      const expense = await createExpenseMutation.mutateAsync(data)
      await reconcileMutation.mutateAsync({ bankTransactionId: tx.id, action: "MATCH", expenseId: expense.id })
      toast.success("Dépense créée et conciliée")
      setExpenseModal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const columns: Column<BankTx>[] = [
    {
      key: "date",
      header: "Date",
      className: "w-28",
      cell: (tx) => format(new Date(tx.transactionDate), "dd/MM/yyyy", { locale: fr }),
    },
    {
      key: "label",
      header: "Libellé bancaire",
      cell: (tx) => (
        <div>
          <p className="font-medium text-sm">{tx.label}</p>
          <p className="text-xs text-muted-foreground">{tx.bankAccount.accountName}</p>
          {tx.reconciliations[0] && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
              → {tx.reconciliations[0].income?.description || tx.reconciliations[0].income?.membre?.lastName || tx.reconciliations[0].expense?.description || tx.reconciliations[0].expense?.vendor || "Concilié"}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Montant",
      className: "w-32 text-right",
      cell: (tx) => (
        <span className={cn("font-semibold tabular-nums flex items-center justify-end gap-1", tx.type === "CREDIT" ? "text-green-600 dark:text-green-400" : "text-destructive")}>
          {tx.type === "CREDIT" ? <TrendingUpIcon className="size-3.5" /> : <TrendingDownIcon className="size-3.5" />}
          {tx.type === "CREDIT" ? "+" : "−"}{fmt(tx.amount)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Statut",
      className: "w-28",
      cell: (tx) => {
        const cfg = statusConfig[tx.status] ?? { label: tx.status, variant: "secondary" as const }
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>
      },
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-52",
      hideInCard: true,
      cell: (tx) => {
        if (tx.status === "MATCHED") return null
        if (tx.status === "IGNORED" || tx.status === "DUPLICATE") {
          return (
            <Button
              size="sm" variant="ghost"
              className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
              onClick={() => handleReactivate(tx)}
              title="Remettre en non-concilié"
            >
              <RotateCcwIcon className="size-3 mr-1" />Réactiver
            </Button>
          )
        }
        return (
          <div className="flex items-center gap-1 flex-wrap">
            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setMatchModal(tx)}>
              <LinkIcon className="size-3 mr-1" />Associer
            </Button>
            {tx.type === "CREDIT" ? (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-green-700" onClick={() => setIncomeModal(tx)}>
                + Recette
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-red-700" onClick={() => setExpenseModal(tx)}>
                + Dépense
              </Button>
            )}
            <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-foreground" onClick={() => handleIgnore(tx)} title="Ignorer">
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
        title="Conciliation bancaire"
        description="Associez les transactions bancaires importées à vos recettes et dépenses."
      />

      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-lg border overflow-hidden">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(1) }}
              className={cn(
                "px-3 py-1.5 text-sm transition-colors",
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
            placeholder="Tous les comptes"
            width="w-48"
          />
        )}
      </div>

      <DataTable
        columns={columns}
        data={transactions}
        loading={isLoading}
        keyExtractor={(tx) => tx.id}
        empty="Aucune transaction à afficher"
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
            toast.success("Conciliation validée")
            setMatchModal(null)
          }}
        />
      )}

      {/* Create income from transaction */}
      {incomeModal && (
        <Modal open={!!incomeModal} onOpenChange={(o) => !o && setIncomeModal(null)} title="Créer une recette" size="md" dismissable={false}>
          <p className="text-sm text-muted-foreground mb-4">Transaction : <strong>{incomeModal.label}</strong> · +{fmt(incomeModal.amount)}</p>
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
        <Modal open={!!expenseModal} onOpenChange={(o) => !o && setExpenseModal(null)} title="Créer une dépense" size="md" dismissable={false}>
          <p className="text-sm text-muted-foreground mb-4">Transaction : <strong>{expenseModal.label}</strong> · −{fmt(expenseModal.amount)}</p>
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
