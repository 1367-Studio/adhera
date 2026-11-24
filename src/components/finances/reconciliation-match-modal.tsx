"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type Transaction = { id: string; label: string; amount: string; type: "CREDIT" | "DEBIT" }
type Suggestion  = {
  type:   "income" | "expense"
  score:  number
  entity: { id: string; amount: string; description?: string | null; vendor?: string | null; date: string; membre?: { firstName: string; lastName: string } | null }
} | {
  type:   "transfer"
  score:  number
  entity: { id: string; amount: string; date: string; fromAccount: { accountName: string; bankName: string }; toAccount: { accountName: string; bankName: string } }
}

interface Props {
  transaction: Transaction
  open:        boolean
  onOpenChange: (o: boolean) => void
  onMatch:     (ids: { incomeId?: string; expenseId?: string; transferId?: string; incomeIds?: string[]; expenseIds?: string[] }) => Promise<void>
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 80 ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
    : score >= 50 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
    : "bg-muted text-muted-foreground"
  return <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", cls)}>{score}%</span>
}

// A transfer only ever reconciles 1:1 (its own two-leg accounting already lives on the
// AccountTransfer row itself) — selecting one clears any income/expense picks and is
// mutually exclusive with them, unlike income/expense which can be multi-selected together
// to cover a grouped Stripe payout (FORM-116 block 8).
const EPSILON = 0.01

export function ReconciliationMatchModal({ transaction, open, onOpenChange, onMatch }: Props) {
  const t = useTranslations()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading]   = useState(false)

  const { data, isLoading } = useQuery({
    queryKey:  ["tx-suggestions", transaction.id],
    queryFn:   async () => {
      const res = await fetch(`/api/finances/reconcile/suggestions?bankTransactionId=${transaction.id}`)
      return res.json()
    },
    enabled: open,
  })

  const suggestions: Suggestion[] = data?.suggestions ?? []
  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const selectedSuggestions = suggestions.filter(s => selected.has(s.entity.id))
  const selectedSum         = selectedSuggestions.reduce((sum, s) => sum + Number(s.entity.amount), 0)
  const txAmount            = Number(transaction.amount)
  const isTransferSelection = selectedSuggestions.length === 1 && selectedSuggestions[0].type === "transfer"
  const sumMatches          = selectedSuggestions.length > 0 && Math.abs(selectedSum - txAmount) < EPSILON
  // A single income/expense pick always confirms (mirrors the pre-group behavior — the server's
  // singular MATCH branch never validated the amount, just recorded a matchScore). Only a real
  // group (2+) requires the sum to match, since that's what the server's array branch enforces.
  const canConfirm          = isTransferSelection || selectedSuggestions.length === 1 || sumMatches

  function toggle(s: Suggestion) {
    setSelected(prev => {
      if (s.type === "transfer") {
        return prev.has(s.entity.id) ? new Set() : new Set([s.entity.id])
      }
      const next = new Set(prev)
      // Selecting an income/expense drops any transfer pick — the two modes are exclusive.
      const selectedTransfer = suggestions.find(x => x.type === "transfer" && next.has(x.entity.id))
      if (selectedTransfer) next.delete(selectedTransfer.entity.id)
      if (next.has(s.entity.id)) next.delete(s.entity.id)
      else next.add(s.entity.id)
      return next
    })
  }

  async function handleConfirm() {
    if (!canConfirm) return
    setLoading(true)
    try {
      if (isTransferSelection) {
        await onMatch({ transferId: selectedSuggestions[0].entity.id })
      } else {
        const incomeIds  = selectedSuggestions.filter(s => s.type === "income").map(s => s.entity.id)
        const expenseIds = selectedSuggestions.filter(s => s.type === "expense").map(s => s.entity.id)
        // Single selection keeps using the plain singular shape — only a genuine group needs
        // the array fields, so the common case's request/behavior is unchanged.
        await onMatch(
          incomeIds.length + expenseIds.length === 1
            ? (incomeIds[0] ? { incomeId: incomeIds[0] } : { expenseId: expenseIds[0] })
            : { incomeIds: incomeIds.length ? incomeIds : undefined, expenseIds: expenseIds.length ? expenseIds : undefined },
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("finances.reconciliationMatchModal.title")} size="md">
      <div className="space-y-4">
        <div className="rounded-lg bg-muted/30 p-3 text-sm">
          <p className="font-medium">{transaction.label}</p>
          <p className="text-muted-foreground">{transaction.type === "CREDIT" ? "+" : "−"}{fmt(transaction.amount)}</p>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground text-center py-4">{t("finances.reconciliationMatchModal.searching")}</p>}

        {!isLoading && suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">{t("finances.reconciliationMatchModal.noMatches")}</p>
        )}

        {!isLoading && suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("finances.reconciliationMatchModal.suggestedMatches")}</p>
            {suggestions.map(s => (
              <button
                key={s.entity.id}
                onClick={() => toggle(s)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 transition-colors",
                  selected.has(s.entity.id) ? "border-foreground bg-muted/30" : "hover:border-muted-foreground/40",
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={s.type === "income" ? "default" : s.type === "expense" ? "secondary" : "outline"} className="text-xs">
                      {s.type === "income" ? t("finances.reconciliationMatchModal.typeIncome")
                        : s.type === "expense" ? t("finances.reconciliationMatchModal.typeExpense")
                        : t("finances.reconciliationMatchModal.typeTransfer")}
                    </Badge>
                    <ScoreBadge score={s.score} />
                  </div>
                  <span className="font-semibold tabular-nums text-sm">{fmt(s.entity.amount)}</span>
                </div>
                <p className="text-sm">
                  {s.type === "transfer"
                    ? `${s.entity.fromAccount.accountName} → ${s.entity.toAccount.accountName}`
                    : s.entity.description || (s.entity as { vendor?: string }).vendor || (s.entity.membre ? `${s.entity.membre.firstName} ${s.entity.membre.lastName}` : "—")}
                </p>
                <p className="text-xs text-muted-foreground">{new Date(s.entity.date).toLocaleDateString("fr-FR", { timeZone: "UTC" })}</p>
              </button>
            ))}
          </div>
        )}

        {selectedSuggestions.length > 1 && (
          <div className={cn(
            "rounded-lg border p-3 text-sm flex items-center justify-between",
            sumMatches ? "border-green-600/40 bg-green-50 dark:bg-green-950/30" : "border-muted-foreground/30 bg-muted/30",
          )}>
            <span>{t("finances.reconciliationMatchModal.selectedCount", { count: selectedSuggestions.length })}</span>
            <span className="font-semibold tabular-nums">
              {fmt(selectedSum)} / {fmt(transaction.amount)}
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={handleConfirm} disabled={!canConfirm} loading={loading}>{t("finances.reconciliationMatchModal.confirm")}</Button>
        </div>
      </div>
    </Modal>
  )
}
