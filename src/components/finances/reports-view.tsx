"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import * as XLSX from "xlsx"
import { DownloadSimpleIcon, TrendUpIcon, TrendDownIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

type Row = { amount: string; category?: { name: string } | null; date: string; description?: string | null; vendor?: string | null; status?: string }

async function fetchAll(url: string) {
  const res = await fetch(url)
  return res.json() as Promise<Row[] | { data: Row[] }>
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

function CategoryTable({ data, colorClass }: { data: Record<string, number>; colorClass: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  const total   = entries.reduce((s, [, n]) => s + n, 0)
  return (
    <table className="w-full text-sm">
      <tbody>
        {entries.map(([name, amount]) => (
          <tr key={name} className="border-b last:border-0">
            <td className="py-2 text-muted-foreground">{name}</td>
            <td className={`py-2 text-right font-medium tabular-nums ${colorClass}`}>{fmt(amount)}</td>
            <td className="py-2 text-right text-xs text-muted-foreground w-14">{total > 0 ? Math.round((amount / total) * 100) : 0}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ReportsView() {
  const [year, setYear] = useState(currentYear)

  const dateFrom = `${year}-01-01`
  const dateTo   = `${year}-12-31`

  const { data: incomes = [], isLoading: loadingI } = useQuery({
    queryKey: ["report-incomes", year],
    queryFn:  () => fetchAll(`/api/finances/incomes?dateFrom=${dateFrom}&dateTo=${dateTo}`).then(d => Array.isArray(d) ? d : d.data),
    staleTime: 60_000,
  })

  const { data: expenses = [], isLoading: loadingE } = useQuery({
    queryKey: ["report-expenses", year],
    queryFn:  () => fetchAll(`/api/finances/expenses?dateFrom=${dateFrom}&dateTo=${dateTo}`).then(d => Array.isArray(d) ? d : d.data),
    staleTime: 60_000,
  })

  const loading = loadingI || loadingE

  // Only PAID income / VALIDATED expense rows represent money that actually moved —
  // PENDING, DRAFT, and CANCELLED rows are shown in the raw export (with their status
  // labeled) but must not count toward totals or category breakdowns.
  const paidIncomes      = incomes.filter(i => i.status === "PAID")
  const validatedExpenses = expenses.filter(e => e.status === "VALIDATED")

  const totalIncomes  = paidIncomes.reduce((s, i) => s + Number(i.amount), 0)
  const totalExpenses = validatedExpenses.reduce((s, e) => s + Number(e.amount), 0)

  function groupByCategory(rows: Row[]): Record<string, number> {
    return rows.reduce((acc, row) => {
      const key = row.category?.name ?? "Non catégorisé"
      acc[key] = (acc[key] ?? 0) + Number(row.amount)
      return acc
    }, {} as Record<string, number>)
  }

  const incomeByCategory  = groupByCategory(paidIncomes)
  const expenseByCategory = groupByCategory(validatedExpenses)

  const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  function exportExcel() {
    const wb = XLSX.utils.book_new()

    const incomeSheet = XLSX.utils.json_to_sheet(
      incomes.map(i => ({
        Date:        i.date.split("T")[0],
        Description: i.description ?? "",
        Catégorie:   i.category?.name ?? "",
        Montant:     Number(i.amount),
        Statut:      i.status ?? "",
      }))
    )
    XLSX.utils.book_append_sheet(wb, incomeSheet, "Recettes")

    const expenseSheet = XLSX.utils.json_to_sheet(
      expenses.map(e => ({
        Date:        e.date.split("T")[0],
        Description: e.description ?? "",
        Fournisseur: e.vendor ?? "",
        Catégorie:   e.category?.name ?? "",
        Montant:     Number(e.amount),
        Statut:      e.status ?? "",
      }))
    )
    XLSX.utils.book_append_sheet(wb, expenseSheet, "Dépenses")

    const summaryData = [
      { Catégorie: "RECETTES", Montant: "" },
      ...Object.entries(incomeByCategory).map(([name, amount]) => ({ Catégorie: name, Montant: amount })),
      { Catégorie: "TOTAL RECETTES", Montant: totalIncomes },
      { Catégorie: "", Montant: "" },
      { Catégorie: "DÉPENSES", Montant: "" },
      ...Object.entries(expenseByCategory).map(([name, amount]) => ({ Catégorie: name, Montant: amount })),
      { Catégorie: "TOTAL DÉPENSES", Montant: totalExpenses },
      { Catégorie: "", Montant: "" },
      { Catégorie: "RÉSULTAT", Montant: totalIncomes - totalExpenses },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), "Résumé")

    XLSX.writeFile(wb, `rapport-financier-${year}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rapports"
        description="Synthèse financière par période."
        action={
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={v => setYear(parseInt(v ?? String(year)))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={exportExcel} disabled={loading}>
              <DownloadSimpleIcon className="mr-1.5 size-4" />
              Exporter Excel
            </Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Total recettes", value: totalIncomes,              color: "text-green-600 dark:text-green-400", prefix: "+" },
          { label: "Total dépenses", value: -totalExpenses,            color: "text-destructive",                   prefix: "" },
          { label: "Résultat",       value: totalIncomes - totalExpenses, color: totalIncomes - totalExpenses >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive", prefix: totalIncomes - totalExpenses >= 0 ? "+" : "" },
        ].map(({ label, value, color, prefix }) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label} {year}</p>
            <p className={`text-2xl font-bold tabular-nums mt-1 ${color}`}>{prefix}{fmt(value)}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => <div key={i} className="rounded-xl border bg-card p-4 h-48 animate-pulse bg-muted/30" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendUpIcon className="size-4 text-green-600" />
              <h3 className="font-semibold text-sm">Recettes par catégorie</h3>
            </div>
            {Object.keys(incomeByCategory).length > 0
              ? <CategoryTable data={incomeByCategory} colorClass="text-green-600 dark:text-green-400" />
              : <p className="text-sm text-muted-foreground">Aucune recette</p>
            }
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendDownIcon className="size-4 text-destructive" />
              <h3 className="font-semibold text-sm">Dépenses par catégorie</h3>
            </div>
            {Object.keys(expenseByCategory).length > 0
              ? <CategoryTable data={expenseByCategory} colorClass="text-destructive" />
              : <p className="text-sm text-muted-foreground">Aucune dépense</p>
            }
          </div>
        </div>
      )}
    </div>
  )
}
