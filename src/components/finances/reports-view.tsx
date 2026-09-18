"use client"

import { useState } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import * as XLSX from "xlsx"
import { DownloadSimpleIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { INCOME_BUCKETS, EXPENSE_BUCKETS, sanitizeForFilename, type IncomeStatementPeriod } from "@/lib/finance/income-statement-shared"
import { exportIncomeStatementPdf, type IncomeStatementPdfRow } from "@/lib/pdf/income-statement-pdf-client"

type ApiResponse = {
  exercices: { id: string; label: string }[]
  current:   IncomeStatementPeriod | null
  previous:  IncomeStatementPeriod | null
}

async function fetchReport(exerciceId: string): Promise<ApiResponse> {
  const params = exerciceId ? `?exerciceId=${exerciceId}` : ""
  const res = await fetch(`/api/finances/rapports/compte-resultat${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

export function ReportsView() {
  const t = useTranslations()
  const [exerciceId, setExerciceId] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["compte-resultat", exerciceId],
    queryFn:  () => fetchReport(exerciceId),
    staleTime: 30_000,
    // Keeps the previous exercice's table on screen while the next one loads instead of
    // flashing back to the skeleton on every Select change.
    placeholderData: keepPreviousData,
  })

  const exercices = data?.exercices ?? []
  const current   = data?.current  ?? null
  const previous  = data?.previous ?? null

  // The API defaults to the latest exercice when none is explicitly requested — this is
  // only for what the Select displays, never fed back into state (that would just be
  // setState-in-effect with extra steps).
  const selectedExerciceId = exerciceId || current?.exercice?.id || ""

  const incomeLabels  = INCOME_BUCKETS.map(key  => ({ key, label: t(`finances.compteResultat.categories.income.${key}`) }))
  const expenseLabels = EXPENSE_BUCKETS.map(key => ({ key, label: t(`finances.compteResultat.categories.expense.${key}`) }))

  // Titles the result row after the *current* period only — the same row can't carry two
  // different titles for two columns. The N-1 cell still gets its own sign-correct color
  // below (previousIsDeficit), so a loss year never reads as ambiguous just because the
  // row's label was decided by the other column.
  const resultLabel = current && current.result >= 0 ? t("finances.compteResultat.surplus") : t("finances.compteResultat.deficit")
  // previous.exercice is null both when there's genuinely no prior exercice AND when this
  // whole period object is the zero-filled placeholder computeIncomeStatementPeriod returns
  // for that case — checking `previous` alone is never false, since that placeholder object
  // is still truthy. hasPrevious is the actual signal for "is there real N-1 data to show".
  const hasPrevious   = Boolean(previous?.exercice)
  const previousLabel = previous?.exercice?.label ?? t("finances.compteResultat.noPreviousExercice")
  const previousIsDeficit = hasPrevious && previous!.result < 0

  function buildRows(): IncomeStatementPdfRow[] {
    if (!current) return []
    // null here means "blank cell" in the PDF renderer — used both for section-header rows
    // (no amount in either column) and, via prevOrBlank, for a genuinely absent N-1 period
    // (as opposed to an N-1 period that legitimately summed to zero).
    const prevOrBlank = (value: number) => hasPrevious ? value : null
    const rows: IncomeStatementPdfRow[] = []
    rows.push({ label: t("finances.compteResultat.products"), current: null, previous: null, bold: true })
    for (const { key, label } of incomeLabels) {
      rows.push({ label, current: current.income[key], previous: prevOrBlank(previous?.income[key] ?? 0) })
    }
    rows.push({ label: t("finances.compteResultat.totalProducts"), current: current.totalIncome, previous: prevOrBlank(previous?.totalIncome ?? 0), bold: true })
    rows.push({ label: t("finances.compteResultat.expenses"), current: null, previous: null, bold: true })
    for (const { key, label } of expenseLabels) {
      rows.push({ label, current: current.expense[key], previous: prevOrBlank(previous?.expense[key] ?? 0) })
    }
    rows.push({ label: t("finances.compteResultat.totalExpenses"), current: current.totalExpense, previous: prevOrBlank(previous?.totalExpense ?? 0), bold: true })
    rows.push({ label: resultLabel, current: current.result, previous: prevOrBlank(previous?.result ?? 0), bold: true })
    return rows
  }

  function exportExcel() {
    if (!current?.exercice) return
    // "" here means a genuinely blank cell (no N-1 period to report), kept distinct from a
    // real 0 — same reasoning as prevOrBlank in buildRows() above.
    const prevOrBlank = (value: number): number | string => hasPrevious ? value : ""
    const header = ["", current.exercice.label, previousLabel]
    const aoa: (string | number)[][] = [header]
    aoa.push([t("finances.compteResultat.products"), "", ""])
    for (const { key, label } of incomeLabels) aoa.push([label, current.income[key], prevOrBlank(previous?.income[key] ?? 0)])
    aoa.push([t("finances.compteResultat.totalProducts"), current.totalIncome, prevOrBlank(previous?.totalIncome ?? 0)])
    aoa.push(["", "", ""])
    aoa.push([t("finances.compteResultat.expenses"), "", ""])
    for (const { key, label } of expenseLabels) aoa.push([label, current.expense[key], prevOrBlank(previous?.expense[key] ?? 0)])
    aoa.push([t("finances.compteResultat.totalExpenses"), current.totalExpense, prevOrBlank(previous?.totalExpense ?? 0)])
    aoa.push(["", "", ""])
    aoa.push([resultLabel, current.result, prevOrBlank(previous?.result ?? 0)])

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), t("finances.compteResultat.title"))
    XLSX.writeFile(wb, `compte-de-resultat-${sanitizeForFilename(current.exercice.label)}.xlsx`)
  }

  function exportPdf() {
    if (!current?.exercice) return
    exportIncomeStatementPdf({
      title:          t("finances.compteResultat.title"),
      currentLabel:   current.exercice.label,
      previousLabel,
      rows:           buildRows(),
      fileNameSuffix: sanitizeForFilename(current.exercice.label),
    })
  }

  const noExercice = !isLoading && exercices.length === 0

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.compteResultat.title")}
        description={t("finances.compteResultat.description")}
        action={
          !noExercice && (
            <div className="flex items-center gap-2">
              <Select value={selectedExerciceId} onValueChange={v => setExerciceId(v ?? selectedExerciceId)}>
                <SelectTrigger className="w-44">
                  <SelectValue>
                    {exercices.find(e => e.id === selectedExerciceId)?.label ?? t("finances.compteResultat.exerciceLabel")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {exercices.map(e => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={!current?.exercice} />}>
                  <DownloadSimpleIcon className="mr-1.5 size-4" />
                  {t("finances.compteResultat.export")}
                  <CaretDownIcon className="ml-1 size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportExcel}>{t("finances.compteResultat.exportExcel")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportPdf}>{t("finances.compteResultat.exportPdf")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />

      {noExercice ? (
        <EmptyState
          title={t("finances.compteResultat.emptyExercice.title")}
          description={t("finances.compteResultat.emptyExercice.description")}
        />
      ) : isLoading || !current ? (
        <div className="h-72 animate-pulse rounded-lg border bg-muted/30" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="py-2 pl-4 pr-3 text-left font-medium text-muted-foreground">{t("finances.compteResultat.exerciceLabel")}</th>
                <th className="py-2 px-3 text-right font-medium text-muted-foreground w-36">{current.exercice!.label}</th>
                <th className="py-2 pr-4 pl-3 text-right font-medium text-muted-foreground w-36">{previousLabel}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td colSpan={3} className="pt-3 pb-1 pl-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("finances.compteResultat.products")}
                </td>
              </tr>
              {incomeLabels.map(({ key, label }) => (
                <tr key={key} className="border-b last:border-0">
                  <td className="py-1.5 pl-4 pr-3 text-muted-foreground">{label}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{fmt(current.income[key])}</td>
                  <td className="py-1.5 pr-4 pl-3 text-right tabular-nums text-muted-foreground">{hasPrevious ? fmt(previous!.income[key]) : previousLabel}</td>
                </tr>
              ))}
              <tr className="border-b-2 border-foreground/20">
                <td className="py-2 pl-4 pr-3 font-semibold">{t("finances.compteResultat.totalProducts")}</td>
                <td className="py-2 px-3 text-right font-semibold tabular-nums">{fmt(current.totalIncome)}</td>
                <td className="py-2 pr-4 pl-3 text-right font-semibold tabular-nums text-muted-foreground">{hasPrevious ? fmt(previous!.totalIncome) : previousLabel}</td>
              </tr>

              <tr className="border-b">
                <td colSpan={3} className="pt-3 pb-1 pl-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("finances.compteResultat.expenses")}
                </td>
              </tr>
              {expenseLabels.map(({ key, label }) => (
                <tr key={key} className="border-b last:border-0">
                  <td className="py-1.5 pl-4 pr-3 text-muted-foreground">{label}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{fmt(current.expense[key])}</td>
                  <td className="py-1.5 pr-4 pl-3 text-right tabular-nums text-muted-foreground">{hasPrevious ? fmt(previous!.expense[key]) : previousLabel}</td>
                </tr>
              ))}
              <tr className="border-b-2 border-foreground/20">
                <td className="py-2 pl-4 pr-3 font-semibold">{t("finances.compteResultat.totalExpenses")}</td>
                <td className="py-2 px-3 text-right font-semibold tabular-nums">{fmt(current.totalExpense)}</td>
                <td className="py-2 pr-4 pl-3 text-right font-semibold tabular-nums text-muted-foreground">{hasPrevious ? fmt(previous!.totalExpense) : previousLabel}</td>
              </tr>

              <tr>
                <td className="py-3 pl-4 pr-3 font-semibold">{resultLabel}</td>
                <td className={`py-3 px-3 text-right font-semibold tabular-nums ${current.result >= 0 ? "" : "text-destructive"}`}>
                  {fmt(current.result)}
                </td>
                <td className={`py-3 pr-4 pl-3 text-right font-semibold tabular-nums ${previousIsDeficit ? "text-destructive" : "text-muted-foreground"}`}>
                  {hasPrevious ? fmt(previous!.result) : previousLabel}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
