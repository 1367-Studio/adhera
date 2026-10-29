"use client"

import { useState } from "react"
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Modal } from "@/components/ui/modal"
import { apiErrorMessage } from "@/lib/api-error"
import { useFinanceCategories } from "@/hooks/use-finance-categories"
import type { TransactionDetail } from "@/lib/finance/income-statement-shared"

// Shared by the Compte de résultat (reports-view.tsx) and the Orçamento previsto
// (previsionnel-global-tab.tsx / previsionnel-project-tab.tsx) "à catégoriser" drill-downs —
// one component, so fixing a transaction's category always looks and behaves identically no
// matter which report it was opened from, and both reports see the fix immediately (the
// underlying categoryId they both read from is the same column — see category-resolution.ts).
export type DrillDown = {
  title:         string
  transactions:  TransactionDetail[]
  type:          "INCOME" | "EXPENSE"
  categorizable: boolean
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

function CategorizeSelect({ transaction, type, invalidateKeys, onDone }: {
  transaction:     TransactionDetail
  type:            "INCOME" | "EXPENSE"
  invalidateKeys:  QueryKey[]
  onDone:          (transactionId: string) => void
}) {
  const t  = useTranslations("finances.compteResultat.drillDown")
  const qc = useQueryClient()
  const { data: categories = [] } = useFinanceCategories(type)

  const mutation = useMutation({
    mutationFn: async (categoryId: string) => {
      const endpoint = type === "INCOME" ? "incomes" : "expenses"
      const res = await fetch(`/api/finances/${endpoint}/${transaction.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ categoryId }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
      return res.json()
    },
    onSuccess: () => {
      toast.success(t("categorizeSuccess"))
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key })
      onDone(transaction.id)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <Select value="" onValueChange={(v) => v && mutation.mutate(v)} disabled={mutation.isPending}>
      <SelectTrigger size="sm" className="h-8 w-44">
        <SelectValue>{t("categorizePlaceholder")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {categories.map((c: { id: string; name: string }) => (
          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function TransactionDrillDownModal({ drillDown, onClose, invalidateKeys }: {
  drillDown:      DrillDown | null
  onClose:        () => void
  // Query keys to invalidate after a successful categorize — the caller's own report query
  // (["compte-resultat"], ["budget-global", exerciceId]...), so the fix shows up immediately
  // wherever it was opened from.
  invalidateKeys: QueryKey[]
}) {
  const t = useTranslations("finances.compteResultat.drillDown")
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [trackedTitle, setTrackedTitle] = useState(drillDown?.title)

  // Reset the locally-hidden (just categorized) rows whenever a different line is opened —
  // adjusted during render (React's recommended pattern) rather than in an effect, so this
  // doesn't cost an extra render pass every time the modal opens.
  if (drillDown?.title !== trackedTitle) {
    setTrackedTitle(drillDown?.title)
    setHidden(new Set())
  }

  if (!drillDown) return null
  const visible = drillDown.transactions.filter(tx => !hidden.has(tx.id))

  return (
    <Modal open={!!drillDown} onOpenChange={(open) => !open && onClose()} title={drillDown.title} size="4xl">
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{t("noTransactions")}</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">{t("date")}</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">{t("origin")}</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">{t("person")}</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">{t("payment")}</th>
                <th className="py-2 px-3 text-right font-medium text-muted-foreground">{t("amount")}</th>
                {drillDown.categorizable && <th className="py-2 px-3 text-right font-medium text-muted-foreground">{t("categorize")}</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(tx => (
                <tr key={tx.id} className="border-b last:border-0">
                  <td className="py-2 px-3 whitespace-nowrap">{format(new Date(tx.date), "dd/MM/yyyy", { locale: fr })}</td>
                  <td className="py-2 px-3 text-muted-foreground">{tx.origin}</td>
                  <td className="py-2 px-3 text-muted-foreground">{tx.personName ?? "—"}</td>
                  <td className="py-2 px-3 text-muted-foreground">{tx.paymentMethod ?? "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmt(tx.amount)}</td>
                  {drillDown.categorizable && (
                    <td className="py-2 px-3 text-right">
                      <CategorizeSelect
                        transaction={tx}
                        type={drillDown.type}
                        invalidateKeys={invalidateKeys}
                        onDone={(id) => setHidden(prev => new Set(prev).add(id))}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
