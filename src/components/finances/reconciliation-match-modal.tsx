"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type Transaction = { id: string; label: string; amount: string; type: "CREDIT" | "DEBIT" }
type Suggestion  = {
  type:   "income" | "expense"
  score:  number
  entity: { id: string; amount: string; description?: string | null; vendor?: string | null; date: string; membre?: { firstName: string; lastName: string } | null }
}

interface Props {
  transaction: Transaction
  open:        boolean
  onOpenChange: (o: boolean) => void
  onMatch:     (ids: { incomeId?: string; expenseId?: string }) => Promise<void>
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 80 ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
    : score >= 50 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
    : "bg-muted text-muted-foreground"
  return <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", cls)}>{score}%</span>
}

export function ReconciliationMatchModal({ transaction, open, onOpenChange, onMatch }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
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

  async function handleConfirm() {
    if (!selected) return
    const sug = suggestions.find(s => s.entity.id === selected)
    if (!sug) return
    setLoading(true)
    try {
      await onMatch(sug.type === "income" ? { incomeId: selected } : { expenseId: selected })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Associer à une recette / dépense" size="md">
      <div className="space-y-4">
        <div className="rounded-lg bg-muted/30 p-3 text-sm">
          <p className="font-medium">{transaction.label}</p>
          <p className="text-muted-foreground">{transaction.type === "CREDIT" ? "+" : "−"}{fmt(transaction.amount)}</p>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground text-center py-4">Recherche de correspondances…</p>}

        {!isLoading && suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Aucune correspondance trouvée à ±7 jours.</p>
        )}

        {!isLoading && suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Correspondances suggérées</p>
            {suggestions.map(s => (
              <button
                key={s.entity.id}
                onClick={() => setSelected(s.entity.id)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 transition-colors",
                  selected === s.entity.id ? "border-foreground bg-muted/30" : "hover:border-muted-foreground/40",
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={s.type === "income" ? "default" : "secondary"} className="text-xs">
                      {s.type === "income" ? "Recette" : "Dépense"}
                    </Badge>
                    <ScoreBadge score={s.score} />
                  </div>
                  <span className="font-semibold tabular-nums text-sm">{fmt(s.entity.amount)}</span>
                </div>
                <p className="text-sm">{s.entity.description || (s.entity as { vendor?: string }).vendor || (s.entity.membre ? `${s.entity.membre.firstName} ${s.entity.membre.lastName}` : "—")}</p>
                <p className="text-xs text-muted-foreground">{new Date(s.entity.date).toLocaleDateString("fr-FR")}</p>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleConfirm} disabled={!selected} loading={loading}>Valider la conciliation</Button>
        </div>
      </div>
    </Modal>
  )
}
