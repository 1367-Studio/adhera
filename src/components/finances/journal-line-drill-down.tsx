"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { Modal } from "@/components/ui/modal"
import type { JournalSourceType } from "@prisma/client"

// Bilan drill-down (FORM-107) — read-only, fetched on open since computeBilanPeriod only ever
// aggregates (see bilan.ts); unlike TransactionDrillDownModal there's no pre-loaded
// transactions array to show, and no categorize action (a JournalLine isn't categorizable).
export type JournalLineDetail = {
  id:         string
  date:       string // ISO
  debit:      number
  credit:     number
  label:      string
  sourceType: JournalSourceType
}

export type JournalDrillDown = {
  title:          string
  chartAccountId: string
  exerciceId:     string
}

async function fetchJournalLines(chartAccountId: string, exerciceId: string): Promise<JournalLineDetail[]> {
  const res = await fetch(`/api/finances/rapports/bilan/lignes?chartAccountId=${chartAccountId}&exerciceId=${exerciceId}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  const data = await res.json()
  return data.lines
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

export function JournalLineDrillDownModal({ drillDown, onClose }: {
  drillDown: JournalDrillDown | null
  onClose:   () => void
}) {
  const t = useTranslations("finances.bilan.drillDown")

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["bilan-lignes", drillDown?.chartAccountId, drillDown?.exerciceId],
    queryFn:  () => fetchJournalLines(drillDown!.chartAccountId, drillDown!.exerciceId),
    enabled:  drillDown !== null,
  })

  if (!drillDown) return null

  return (
    <Modal open={!!drillDown} onOpenChange={(open) => !open && onClose()} title={drillDown.title} size="4xl">
      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted/30" />
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{t("noLines")}</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">{t("date")}</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">{t("label")}</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">{t("origin")}</th>
                <th className="py-2 px-3 text-right font-medium text-muted-foreground">{t("debit")}</th>
                <th className="py-2 px-3 text-right font-medium text-muted-foreground">{t("credit")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="py-2 px-3 whitespace-nowrap">{format(new Date(line.date), "dd/MM/yyyy", { locale: fr })}</td>
                  <td className="py-2 px-3 text-muted-foreground">{line.label}</td>
                  <td className="py-2 px-3 text-muted-foreground">{t(`sourceTypes.${line.sourceType}`)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{line.debit !== 0 ? fmt(line.debit) : ""}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{line.credit !== 0 ? fmt(line.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
