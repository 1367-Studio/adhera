"use client"

import { Fragment, useState } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import * as XLSX from "xlsx"
import { DownloadSimpleIcon, CaretDownIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import {
  FINANCE_SECTIONS, sanitizeForFilename,
  type IncomeStatementPeriod, type CategoryLine, type FinanceSectionKey,
} from "@/lib/finance/income-statement-shared"
import { exportIncomeStatementPdf, type IncomeStatementPdfRow } from "@/lib/pdf/income-statement-pdf-client"
import { TransactionDrillDownModal, type DrillDown as ImportedDrillDown } from "@/components/finances/transaction-drill-down"

type ExerciceOption = { id: string; label: string; startDate: string; endDate: string }

type ApiResponse = {
  exercices: ExerciceOption[]
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

// Exercice boundaries are always stored at UTC midnight (see dayFloorUTC in
// src/lib/finance/exercice.ts) — formatting them in the viewer's local timezone (as plain
// date-fns `format()` does) shifts the displayed date backward for anyone west of UTC (e.g.
// 01/01/2026T00:00Z reads as 31/12/2025 in America/Sao_Paulo). Same fix already established in
// exercices-view.tsx for the same reason.
// Widened to `string | Date` — the shared `ExerciceRef` type (server-side) types these fields
// as `Date`, but after `res.json()` they're actually strings on the client; `new Date(...)`
// already handles either at runtime, this just keeps both call shapes typechecking.
const fmtExerciceDate = (d: string | Date) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" })

// A category line's stable identity across periods — a real category keeps its id, a virtual
// (deleted-default) line keeps its key. Used to match a current-period line against its N-1
// counterpart even though the two periods aren't guaranteed to carry the same categories.
function lineIdentity(line: CategoryLine): string {
  return line.categoryId ?? `key:${line.key}`
}

type DrillDown = ImportedDrillDown

function previousAmountFor(previous: IncomeStatementPeriod | null, line: CategoryLine, type: "income" | "expense"): number {
  if (!previous) return 0
  for (const section of FINANCE_SECTIONS) {
    const match = previous.sections[section][type].find(l => lineIdentity(l) === lineIdentity(line))
    if (match) return match.amount
  }
  return 0
}

// A section is worth rendering plainly (no collapse affordance) when it's OPERATING — every
// association has at least the seeded default categories there — or when it actually has
// activity in the current or N-1 period. Anything else collapses behind a toggle rather than
// vanishing outright, so a treasurer who just created a Financier/Exceptionnel category isn't
// left wondering where their new section went.
function sectionHasActivity(current: IncomeStatementPeriod, previous: IncomeStatementPeriod | null, section: FinanceSectionKey): boolean {
  const currentTotal  = current.sections[section].income.reduce((s, l) => s + Math.abs(l.amount), 0)
                       + current.sections[section].expense.reduce((s, l) => s + Math.abs(l.amount), 0)
  const previousTotal = previous
    ? previous.sections[section].income.reduce((s, l) => s + Math.abs(l.amount), 0)
    + previous.sections[section].expense.reduce((s, l) => s + Math.abs(l.amount), 0)
    : 0
  return currentTotal !== 0 || previousTotal !== 0
}

function Column({ type, current, previous, hasPrevious, previousLabel, selectedExerciceLabel, expandedSections, onToggleSection, onOpenDrillDown, onOpenUncategorized }: {
  type:                  "INCOME" | "EXPENSE"
  current:               IncomeStatementPeriod
  previous:              IncomeStatementPeriod | null
  hasPrevious:           boolean
  previousLabel:         string
  selectedExerciceLabel: string | undefined
  expandedSections:      Set<FinanceSectionKey>
  onToggleSection:       (section: FinanceSectionKey) => void
  onOpenDrillDown:       (line: CategoryLine, type: "INCOME" | "EXPENSE") => void
  onOpenUncategorized:   (type: "INCOME" | "EXPENSE") => void
}) {
  const t = useTranslations()
  const key        = type === "INCOME" ? "income" : "expense"
  const total       = type === "INCOME" ? current.totalIncome : current.totalExpense
  const previousTotal = previous ? (type === "INCOME" ? previous.totalIncome : previous.totalExpense) : 0
  const uncategorized = type === "INCOME" ? current.uncategorizedIncome : current.uncategorizedExpense
  const titleKey    = type === "INCOME" ? "products" : "expenses"
  const totalKey    = type === "INCOME" ? "totalProducts" : "totalExpenses"
  const titleColor  = type === "INCOME" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"

  return (
    <div className="min-w-0">
      <h3 className={`text-sm font-semibold mb-2 ${titleColor}`}>{t(`finances.compteResultat.${titleKey}`)}</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="py-2 pl-4 pr-3 text-left font-medium text-muted-foreground">{t("finances.compteResultat.exerciceLabel")}</th>
              <th className="py-2 px-3 text-right font-medium text-muted-foreground w-32">{selectedExerciceLabel}</th>
              <th className="py-2 pr-4 pl-3 text-right font-medium text-muted-foreground w-32">
                {hasPrevious ? previousLabel : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {FINANCE_SECTIONS.map(section => {
              const lines       = current.sections[section][key]
              const isOperating = section === "OPERATING"
              const hasActivity = isOperating || sectionHasActivity(current, previous, section)
              const isExpanded  = expandedSections.has(section)

              // A section with real activity (or OPERATING, which always has the seeded
              // defaults) stays visible permanently — collapsing is only ever an option for a
              // section with nothing to show. Collapsed, it's reachable via a quiet toggle
              // instead of vanishing outright.
              if (!hasActivity && !isExpanded) {
                return (
                  <tr key={`${section}-toggle`} className="border-b last:border-0">
                    <td colSpan={3} className="py-1 pl-4">
                      <button
                        type="button"
                        onClick={() => onToggleSection(section)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t("finances.compteResultat.expandSection")} — {t(`finances.compteResultat.sections.${section}`)}
                      </button>
                    </td>
                  </tr>
                )
              }

              return (
                <Fragment key={section}>
                  {!isOperating && (
                    <tr className="border-b">
                      <td colSpan={3} className="pt-3 pb-1 pl-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t(`finances.compteResultat.sections.${section}`)}
                        </div>
                        {section === "IMMOBILISATION" && (
                          <div className="text-xs text-muted-foreground font-normal normal-case mt-0.5">
                            {t("finances.compteResultat.immobilisationNote")}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  {lines.length > 0 ? lines.map(line => (
                    <CategoryRow
                      key={lineIdentity(line)}
                      line={line}
                      previousAmount={previousAmountFor(previous, line, key)}
                      hasPrevious={hasPrevious}
                      onOpen={line.amount !== 0 ? () => onOpenDrillDown(line, type) : null}
                    />
                  )) : !isOperating && (
                    <tr className="border-b last:border-0">
                      <td colSpan={3} className="py-2 pl-4 text-xs text-muted-foreground italic">
                        {t("finances.compteResultat.noCategoriesInSection")}
                      </td>
                    </tr>
                  )}
                  {/* Manually expanded but still genuinely empty — give the toggle back so
                      this doesn't become a one-way door. */}
                  {!isOperating && !hasActivity && isExpanded && (
                    <tr className="border-b last:border-0">
                      <td colSpan={3} className="py-1 pl-4">
                        <button
                          type="button"
                          onClick={() => onToggleSection(section)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {t("finances.compteResultat.collapseSection")} — {t(`finances.compteResultat.sections.${section}`)}
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}

            {uncategorized.count > 0 && (
              <CategoryRow
                line={{ categoryId: null, key: "uncategorized", name: t("finances.compteResultat.uncategorized"), accountingCode: null, isDefault: false, amount: uncategorized.amount, transactions: uncategorized.transactions }}
                previousAmount={previous ? (type === "INCOME" ? previous.uncategorizedIncome.amount : previous.uncategorizedExpense.amount) : 0}
                hasPrevious={hasPrevious}
                onOpen={() => onOpenUncategorized(type)}
              />
            )}

            <tr className="border-t-2 border-foreground/20">
              <td className="py-2 pl-4 pr-3 font-semibold">{t(`finances.compteResultat.${totalKey}`)}</td>
              <td className="py-2 px-3 text-right font-semibold tabular-nums">{fmt(total)}</td>
              <td className="py-2 pr-4 pl-3 text-right font-semibold tabular-nums text-muted-foreground">
                {hasPrevious ? fmt(previousTotal) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CategoryRow({ line, previousAmount, hasPrevious, onOpen }: {
  line:           CategoryLine
  previousAmount: number | null
  hasPrevious:    boolean
  onOpen:         (() => void) | null
}) {
  const clickable = onOpen !== null
  return (
    <tr
      className={`border-b last:border-0 ${clickable ? "cursor-pointer hover:bg-muted/40" : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onOpen! : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen!() } } : undefined}
    >
      <td className="py-1.5 pl-4 pr-3 text-muted-foreground">{line.name}</td>
      <td className="py-1.5 px-3 text-right tabular-nums">{fmt(line.amount)}</td>
      <td className="py-1.5 pr-4 pl-3 text-right tabular-nums text-muted-foreground">
        {hasPrevious ? fmt(previousAmount ?? 0) : null}
      </td>
    </tr>
  )
}

export function ReportsView() {
  const t  = useTranslations()
  const [exerciceId, setExerciceId] = useState("")
  const [expandedSections, setExpandedSections] = useState<Set<FinanceSectionKey>>(new Set())
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null)
  const [trackedExerciceId, setTrackedExerciceId] = useState(exerciceId)

  // A drill-down showing the wrong exercice's transactions is worse than one that just closes
  // — adjusted during render (React's recommended pattern) instead of in an effect.
  if (exerciceId !== trackedExerciceId) {
    setTrackedExerciceId(exerciceId)
    setDrillDown(null)
  }

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
  const selectedExercice   = exercices.find(e => e.id === selectedExerciceId)

  const hasPrevious   = Boolean(previous?.exercice)
  const previousLabel = previous?.exercice?.label ?? t("finances.compteResultat.noPreviousExercice")

  const resultLabel = current
    ? current.result > 0 ? t("finances.compteResultat.surplus")
    : current.result < 0 ? t("finances.compteResultat.deficit")
    : t("finances.compteResultat.resultZero")
    : ""
  const previousIsDeficit = hasPrevious && previous!.result < 0

  function toggleSection(section: FinanceSectionKey) {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  function openDrillDown(line: CategoryLine, type: "INCOME" | "EXPENSE") {
    if (line.amount === 0) return
    setDrillDown({ title: line.name, transactions: line.transactions, type, categorizable: false })
  }

  function openUncategorized(type: "INCOME" | "EXPENSE") {
    if (!current) return
    const bucket = type === "INCOME" ? current.uncategorizedIncome : current.uncategorizedExpense
    if (bucket.count === 0) return
    setDrillDown({ title: t("finances.compteResultat.uncategorized"), transactions: bucket.transactions, type, categorizable: true })
  }

  // Mirrors the reference accountant document (see the plan's Fase 5): every section always
  // renders, even fully empty (PRODUITS FINANCIERS/CHARGES FINANCIERES etc. still appear at
  // 0,00 — the export is for the treasurer/accountant, who expects the full statutory shape,
  // unlike the screen which collapses empty sections for readability). Expense amounts are
  // shown NEGATIVE (same convention as the reference), even though they're stored positive.
  function buildRows(): IncomeStatementPdfRow[] {
    if (!current) return []
    const prevOrBlank = (value: number) => hasPrevious ? value : null
    const rows: IncomeStatementPdfRow[] = []
    const pdfT = (key: string) => t(`finances.compteResultat.pdf.${key}`)
    const sectionLabels: Record<FinanceSectionKey, { income: string; expense: string; result: string }> = {
      OPERATING:      { income: pdfT("operatingIncome"),   expense: pdfT("operatingExpense"),   result: pdfT("operatingResult") },
      FINANCIAL:      { income: pdfT("financialIncome"),   expense: pdfT("financialExpense"),   result: pdfT("financialResult") },
      EXCEPTIONAL:    { income: pdfT("exceptionalIncome"), expense: pdfT("exceptionalExpense"), result: pdfT("exceptionalResult") },
      OTHER:          { income: pdfT("otherIncome"),       expense: pdfT("otherExpense"),       result: pdfT("otherResult") },
      IN_KIND:        { income: pdfT("inKindIncome"),      expense: pdfT("inKindExpense"),      result: pdfT("inKindResult") },
      // Informational only — rendered below as its own block, outside this loop, so it never
      // feeds into incomeTotal/expenseTotal/the per-section "result" row the loop below
      // computes for every other section (see RESULT_SECTIONS in income-statement-shared.ts).
      IMMOBILISATION: { income: pdfT("immobilisationIncome"), expense: pdfT("immobilisationExpense"), result: pdfT("immobilisationResult") },
    }
    const lineLabel = (line: CategoryLine) => line.accountingCode ? `${line.accountingCode} - ${line.name}` : line.name

    for (const section of FINANCE_SECTIONS) {
      if (section === "IMMOBILISATION") continue
      const labels = sectionLabels[section]
      const incomeLines = current.sections[section].income
      const expenseLines = current.sections[section].expense

      rows.push({ label: labels.income, current: null, previous: null, bold: true })
      for (const line of incomeLines) {
        rows.push({ label: lineLabel(line), current: line.amount, previous: prevOrBlank(previousAmountFor(previous, line, "income")) })
      }
      const incomeTotal = incomeLines.reduce((s, l) => s + l.amount, 0)
      const incomeTotalPrev = incomeLines.reduce((s, l) => s + previousAmountFor(previous, l, "income"), 0)
      rows.push({ label: pdfT("total"), current: incomeTotal, previous: prevOrBlank(incomeTotalPrev), bold: true })

      rows.push({ label: labels.expense, current: null, previous: null, bold: true })
      for (const line of expenseLines) {
        rows.push({ label: lineLabel(line), current: -line.amount, previous: prevOrBlank(-previousAmountFor(previous, line, "expense")) })
      }
      const expenseTotal = expenseLines.reduce((s, l) => s + l.amount, 0)
      const expenseTotalPrev = expenseLines.reduce((s, l) => s + previousAmountFor(previous, l, "expense"), 0)
      rows.push({ label: pdfT("total"), current: -expenseTotal, previous: prevOrBlank(-expenseTotalPrev), bold: true })

      rows.push({ label: labels.result, current: incomeTotal - expenseTotal, previous: prevOrBlank(incomeTotalPrev - expenseTotalPrev), bold: true })
    }

    // Immobilisations (capital assets/depreciation) — informational block, outside the
    // statutory income/expense/result loop above: never summed into totalIncome/totalExpense/
    // result (see RESULT_SECTIONS). Only printed when there's something to show.
    const immoIncome  = current.sections.IMMOBILISATION.income
    const immoExpense = current.sections.IMMOBILISATION.expense
    if (immoIncome.length > 0 || immoExpense.length > 0) {
      rows.push({ label: pdfT("immobilisationSection"), current: null, previous: null, bold: true })
      for (const line of immoIncome) {
        rows.push({ label: lineLabel(line), current: line.amount, previous: prevOrBlank(previousAmountFor(previous, line, "income")) })
      }
      for (const line of immoExpense) {
        rows.push({ label: lineLabel(line), current: -line.amount, previous: prevOrBlank(-previousAmountFor(previous, line, "expense")) })
      }
    }

    if (current.uncategorizedIncome.count > 0 || current.uncategorizedExpense.count > 0) {
      rows.push({ label: pdfT("uncategorizedSection"), current: null, previous: null, bold: true })
      if (current.uncategorizedIncome.count > 0) {
        rows.push({ label: pdfT("uncategorizedIncomeLabel"), current: current.uncategorizedIncome.amount, previous: prevOrBlank(previous?.uncategorizedIncome.amount ?? 0) })
      }
      if (current.uncategorizedExpense.count > 0) {
        rows.push({ label: pdfT("uncategorizedExpenseLabel"), current: -current.uncategorizedExpense.amount, previous: prevOrBlank(-(previous?.uncategorizedExpense.amount ?? 0)) })
      }
    }

    rows.push({ label: pdfT("grandTotal"), current: current.result, previous: prevOrBlank(previous?.result ?? 0), bold: true })
    return rows
  }

  // Line-item export (item 17 do pedido) — one row per transaction, not per bucket total, so a
  // treasurer/accountant can recover every underlying entry. Uses the exact same transaction
  // lists the on-screen drill-down reads (Fase 2's computeIncomeStatementPeriod), so the two
  // never drift. "À catégoriser" transactions are included too (requisito 11: never disappear
  // from the export), each with a blank account code. Amounts are written as `number`, never a
  // pre-formatted string — avoids the classic "number becomes text" Excel import bug.
  function exportExcel() {
    if (!current?.exercice) return
    const csvT = (key: string) => t(`finances.compteResultat.csv.${key}`)
    const header = [csvT("date"), csvT("type"), csvT("category"), csvT("accountingCode"), csvT("description"), csvT("amount"), csvT("paymentMethod"), csvT("origin"), csvT("reference"), csvT("exercice")]
    const aoa: (string | number)[][] = [header]

    function pushLine(line: CategoryLine, categoryLabel: string, accountingCode: string | number) {
      for (const tx of line.transactions) {
        aoa.push([
          format(new Date(tx.date), "dd/MM/yyyy", { locale: fr }),
          tx.type === "INCOME" ? csvT("typeIncome") : csvT("typeExpense"),
          categoryLabel, accountingCode, tx.description ?? "", tx.amount,
          tx.paymentMethod ?? "", tx.origin, tx.reference ?? "", current!.exercice!.label,
        ])
      }
    }

    for (const section of FINANCE_SECTIONS) {
      for (const line of current.sections[section].income) pushLine(line, line.name, line.accountingCode ?? "")
      for (const line of current.sections[section].expense) pushLine(line, line.name, line.accountingCode ?? "")
    }
    for (const tx of current.uncategorizedIncome.transactions) {
      aoa.push([format(new Date(tx.date), "dd/MM/yyyy", { locale: fr }), csvT("typeIncome"), csvT("uncategorized"), "", tx.description ?? "", tx.amount, tx.paymentMethod ?? "", tx.origin, tx.reference ?? "", current.exercice.label])
    }
    for (const tx of current.uncategorizedExpense.transactions) {
      aoa.push([format(new Date(tx.date), "dd/MM/yyyy", { locale: fr }), csvT("typeExpense"), csvT("uncategorized"), "", tx.description ?? "", tx.amount, tx.paymentMethod ?? "", tx.origin, tx.reference ?? "", current.exercice.label])
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), t("finances.compteResultat.title"))
    XLSX.writeFile(wb, `compte-de-resultat-detaille-${sanitizeForFilename(current.exercice.label)}.xlsx`)
  }

  function exportPdf() {
    if (!current?.exercice) return
    const periodLabel = t("finances.compteResultat.pdf.periodLabel", {
      start: fmtExerciceDate(current.exercice.startDate),
      end:   fmtExerciceDate(current.exercice.endDate),
    })
    exportIncomeStatementPdf({
      title:          t("finances.compteResultat.title"),
      currentLabel:   current.exercice.label,
      previousLabel,
      periodLabel,
      rows:           buildRows(),
      fileNameSuffix: sanitizeForFilename(current.exercice.label),
    })
  }

  const noExercice = !isLoading && exercices.length === 0
  const periodRange = selectedExercice
    ? `${fmtExerciceDate(selectedExercice.startDate)} → ${fmtExerciceDate(selectedExercice.endDate)}`
    : null

  const uncategorizedIncomeCount  = current?.uncategorizedIncome.count  ?? 0
  const uncategorizedExpenseCount = current?.uncategorizedExpense.count ?? 0
  const hasOperationalDetail = current
    ? FINANCE_SECTIONS.some(s => s !== "OPERATING" && sectionHasActivity(current, previous, s))
    : false

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.compteResultat.title")}
        description={t("finances.compteResultat.description")}
        action={
          !noExercice && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Select
                  value={selectedExerciceId}
                  onValueChange={(v) => setExerciceId(v ?? selectedExerciceId)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue>{selectedExercice?.label ?? t("finances.compteResultat.exerciceLabel")}</SelectValue>
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
              {periodRange && <span className="text-xs text-muted-foreground pl-0.5">{periodRange}</span>}
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
        <>
          {!hasPrevious && (
            <p className="text-xs text-muted-foreground">{t("finances.compteResultat.noPreviousExerciceMessage")}</p>
          )}

          {(uncategorizedIncomeCount > 0 || uncategorizedExpenseCount > 0) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 flex items-start gap-2">
              <WarningCircleIcon className="size-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {uncategorizedIncomeCount > 0 && <p>{t("finances.compteResultat.uncategorizedAlertIncome", { count: uncategorizedIncomeCount })}</p>}
                {uncategorizedExpenseCount > 0 && <p>{t("finances.compteResultat.uncategorizedAlertExpense", { count: uncategorizedExpenseCount })}</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Column
              type="INCOME"
              current={current}
              previous={previous}
              hasPrevious={hasPrevious}
              previousLabel={previousLabel}
              selectedExerciceLabel={selectedExercice?.label}
              expandedSections={expandedSections}
              onToggleSection={toggleSection}
              onOpenDrillDown={openDrillDown}
              onOpenUncategorized={openUncategorized}
            />
            <Column
              type="EXPENSE"
              current={current}
              previous={previous}
              hasPrevious={hasPrevious}
              previousLabel={previousLabel}
              selectedExerciceLabel={selectedExercice?.label}
              expandedSections={expandedSections}
              onToggleSection={toggleSection}
              onOpenDrillDown={openDrillDown}
              onOpenUncategorized={openUncategorized}
            />
          </div>

          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{resultLabel}</span>
              <span className={`text-lg font-semibold tabular-nums ${current.result < 0 ? "text-destructive" : ""}`}>{fmt(current.result)}</span>
            </div>
            {hasPrevious && (
              <div className="flex items-baseline justify-between text-sm text-muted-foreground mt-0.5">
                <span>{previousLabel}</span>
                <span className={`tabular-nums ${previousIsDeficit ? "text-destructive" : ""}`}>{fmt(previous!.result)}</span>
              </div>
            )}
            {hasOperationalDetail && (
              <div className="flex items-baseline justify-between text-sm text-muted-foreground mt-2 pt-2 border-t">
                <span>{t("finances.compteResultat.operationalResult")}</span>
                <span className="tabular-nums">{fmt(current.resultOperational)}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Also invalidates the Orçamento previsto queries: categorizing here changes the exact
          same categoryId column computeBudgetPeriod reads, so a cached budget screen must go
          stale too, not just this report's own query. */}
      <TransactionDrillDownModal
        drillDown={drillDown} onClose={() => setDrillDown(null)}
        invalidateKeys={[["compte-resultat"], ["budget-global"], ["budget-project"]]}
      />
    </div>
  )
}
