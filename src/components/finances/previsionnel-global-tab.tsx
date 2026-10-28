"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import * as XLSX from "xlsx"
import {
  TrendUpIcon, TrendDownIcon, ScalesIcon, CaretRightIcon, PlusIcon, DownloadSimpleIcon, CaretDownIcon,
} from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FinanceCategoryForm } from "@/components/finances/finance-category-form"
import { BudgetStatTile } from "@/components/finances/budget-stat-tile"
import { useGlobalBudget, useUpsertBudgetLine } from "@/hooks/use-budget"
import { useCreateFinanceCategory } from "@/hooks/use-finance-categories"
import { budgetLineTone, budgetResultTone } from "@/lib/finance/budget-format"
import { fmtBudgetCurrency as fmt, DiffPercentCell, InlineAmountCell } from "@/components/finances/budget-table-cells"
import { buildBudgetExportRows } from "@/lib/finance/budget-export-shared"
import { sanitizeForFilename } from "@/lib/finance/income-statement-shared"
import { exportBudgetPdf } from "@/lib/pdf/budget-pdf-client"
import { BASE_PATH } from "@/lib/env"
import type { BudgetCategoryLine, BudgetPeriod } from "@/lib/finance/budget-shared"
import type { FinanceCategoryInput } from "@/lib/schemas"
import { cn } from "@/lib/utils"

// Shared by the global and per-project exports (previsionnel-global-tab.tsx and
// previsionnel-project-tab.tsx) — fetched fresh each time rather than cached, since the
// association name/exercice rarely changes but an export is a rare, deliberate action where a
// stale name would be worse than one extra request.
async function fetchAssociationName(): Promise<string> {
  const res = await fetch(`${BASE_PATH}/api/association`)
  if (!res.ok) return "Association"
  const data = await res.json()
  return data?.name ?? "Association"
}

export async function exportBudgetExcel(budget: BudgetPeriod, title: string, labels: {
  income: string; expense: string; uncategorized: string; total: string; result: string
  sheetName: string; headers: { category: string; previsto: string; realizado: string; diff: string; percent: string; association: string; exercice: string }
}) {
  if (!budget.exercice) return
  const associationName = await fetchAssociationName()

  const rows = buildBudgetExportRows(budget, labels)
  const aoa: (string | number)[][] = [
    [labels.headers.association, associationName],
    [labels.headers.exercice, budget.exercice.label],
    [],
    [labels.headers.category, labels.headers.previsto, labels.headers.realizado, labels.headers.diff, labels.headers.percent],
  ]
  for (const row of rows) {
    if (row.previsto === null || row.realizado === null) {
      aoa.push([row.label])
      continue
    }
    const diff = row.realizado - row.previsto
    const percent = row.previsto > 0 ? Math.round((row.realizado / row.previsto) * 100) : null
    aoa.push([row.label, row.previsto, row.realizado, diff, percent ?? "—"])
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), labels.sheetName)
  XLSX.writeFile(wb, `${title}-${sanitizeForFilename(budget.exercice.label)}.xlsx`)
}

function CategoryRow({ line, type, exerciceId }: {
  line:       BudgetCategoryLine
  type:       "income" | "expense"
  exerciceId: string
}) {
  const t = useTranslations("finances.previsionnel")
  const [expanded, setExpanded] = useState(false)
  const upsert = useUpsertBudgetLine()

  const tone = budgetLineTone(type, line.previsto, line.realizado)
  // The "sans projet" part is never stored as its own field — it's whatever's left of the
  // category's total previsto once every project's own line is subtracted out (see
  // computeBudgetPeriod's doc comment in src/lib/finance/budget.ts).
  const projectTotal   = line.projectBreakdown.filter(b => b.projectId).reduce((s, b) => s + b.amount, 0)
  const noProjectAmount = line.previsto - projectTotal

  async function saveNoProjectAmount(amount: number) {
    try {
      await upsert.mutateAsync({ exerciceId, categoryId: line.categoryId, projectId: null, amount })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.updateError"))
    }
  }

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="py-2 pl-2 pr-3">
          <button type="button" onClick={() => setExpanded(e => !e)} className="flex items-center gap-1.5 text-left hover:text-foreground">
            <CaretRightIcon className={cn("size-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
            <span>{line.name}</span>
          </button>
        </td>
        <td className="py-2 px-3 text-right w-32 tabular-nums">{fmt(line.previsto)}</td>
        <td className="py-2 px-3 text-right w-32 tabular-nums">{fmt(line.realizado)}</td>
        <td className="py-2 pr-4 pl-3 text-right w-40"><DiffPercentCell previsto={line.previsto} realizado={line.realizado} tone={tone} /></td>
      </tr>
      {expanded && (
        <>
          {line.projectBreakdown.filter(b => b.projectId).map(b => (
            <tr key={b.projectId} className="border-b last:border-0 bg-muted/20 text-xs">
              <td className="py-1.5 pl-8 pr-3 text-muted-foreground">{b.projectName}</td>
              <td className="py-1.5 px-3 text-right w-32 tabular-nums text-muted-foreground">{fmt(b.amount)}</td>
              <td className="py-1.5 px-3" />
              <td className="py-1.5 pr-4 pl-3" />
            </tr>
          ))}
          <tr className="border-b last:border-0 bg-muted/20 text-xs">
            <td className="py-1.5 pl-8 pr-3 text-muted-foreground">{t("noProject")}</td>
            <td className="py-1.5 px-3 text-right w-32">
              <InlineAmountCell value={noProjectAmount} onSave={saveNoProjectAmount} />
            </td>
            <td className="py-1.5 px-3" />
            <td className="py-1.5 pr-4 pl-3" />
          </tr>
        </>
      )}
    </>
  )
}

function CategorySection({ type, lines, uncategorized, total, exerciceId, onAddCategory }: {
  type:          "income" | "expense"
  lines:         BudgetCategoryLine[]
  uncategorized: { realizado: number; count: number }
  total:         { previsto: number; realizado: number }
  exerciceId:    string
  onAddCategory: () => void
}) {
  const t = useTranslations("finances.previsionnel")
  const titleKey  = type === "income" ? "income" : "expense"
  const titleColor = type === "income" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
  const tone = budgetLineTone(type, total.previsto, total.realizado)

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className={cn("text-sm font-semibold", titleColor)}>{t(titleKey)}</h3>
        <Button size="sm" variant="ghost" onClick={onAddCategory}>
          <PlusIcon className="mr-1.5 size-4" />
          {t("addCategory")}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="py-2 pl-4 pr-3 text-left font-medium text-muted-foreground">{t("columns.category")}</th>
              <th className="py-2 px-3 text-right font-medium text-muted-foreground w-32">{t("columns.previsto")}</th>
              <th className="py-2 px-3 text-right font-medium text-muted-foreground w-32">{t("columns.realizado")}</th>
              <th className="py-2 pr-4 pl-3 text-right font-medium text-muted-foreground w-40">{t("columns.diffPercent")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && uncategorized.count === 0 ? (
              <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">{t("noCategories")}</td></tr>
            ) : (
              <>
                {lines.map(line => <CategoryRow key={line.categoryId} line={line} type={type} exerciceId={exerciceId} />)}
                {uncategorized.count > 0 && (
                  <tr className="border-b last:border-0 text-muted-foreground">
                    <td className="py-2 pl-4 pr-3">{t("uncategorized")}</td>
                    <td className="py-2 px-3 text-right w-32">—</td>
                    <td className="py-2 px-3 text-right w-32 tabular-nums">{fmt(uncategorized.realizado)}</td>
                    <td className="py-2 pr-4 pl-3" />
                  </tr>
                )}
              </>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/40 font-semibold">
              <td className="py-2 pl-4 pr-3">{t("columns.total")}</td>
              <td className="py-2 px-3 text-right w-32 tabular-nums">{fmt(total.previsto)}</td>
              <td className="py-2 px-3 text-right w-32 tabular-nums">{fmt(total.realizado)}</td>
              <td className="py-2 pr-4 pl-3 text-right w-40"><DiffPercentCell previsto={total.previsto} realizado={total.realizado} tone={tone} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export function PrevisionnelGlobalTab({ exerciceId }: { exerciceId: string }) {
  const t = useTranslations("finances.previsionnel")
  const [addCategoryType, setAddCategoryType] = useState<"INCOME" | "EXPENSE" | null>(null)

  const { data, isLoading } = useGlobalBudget(exerciceId)
  const budget = data?.budget ?? null

  const qc = useQueryClient()
  const createCategory = useCreateFinanceCategory()

  // useCreateFinanceCategory only invalidates its own ["finance-categories"] cache — the
  // budget table reads a separate ["budget-global"] query, so without this the new category
  // silently doesn't show up until something else happens to refetch it.
  async function handleCreateCategory(input: FinanceCategoryInput) {
    try {
      await createCategory.mutateAsync(input)
      await qc.invalidateQueries({ queryKey: ["budget-global"] })
      toast.success(t("toasts.categoryCreated"))
      setAddCategoryType(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.updateError"))
    }
  }

  if (isLoading || !budget) {
    return <div className="h-72 animate-pulse rounded-lg border bg-muted/30 mt-4" />
  }

  const resultTone = budgetResultTone(budget.totals.result.previsto, budget.totals.result.realizado)

  const exportLabels = {
    income: t("income"), expense: t("expense"), uncategorized: t("uncategorized"), total: t("columns.total"), result: t("result"),
  }

  function handleExportExcel() {
    exportBudgetExcel(budget!, t("exportFileNameGlobal"), {
      ...exportLabels,
      sheetName: t("title"),
      headers: {
        category: t("columns.category"), previsto: t("columns.previsto"), realizado: t("columns.realizado"),
        diff: t("export.diffColumn"), percent: t("export.percentColumn"),
        association: t("export.associationLabel"), exercice: t("export.exerciceLabel"),
      },
    })
  }

  function handleExportPdf() {
    exportBudgetPdf({
      title:            t("title"),
      exerciceLabel:    budget!.exercice!.label,
      previstoLabel:    t("columns.previsto"),
      realizadoLabel:   t("columns.realizado"),
      diffPercentLabel: t("columns.diffPercent"),
      rows:             buildBudgetExportRows(budget!, exportLabels),
      fileNameSuffix:   sanitizeForFilename(budget!.exercice!.label),
    })
  }

  return (
    <div className="space-y-6 pt-4">
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
            <DownloadSimpleIcon className="mr-1.5 size-4" />
            {t("export.action")}
            <CaretDownIcon className="ml-1 size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleExportExcel}>{t("export.excel")}</DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportPdf}>{t("export.pdf")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BudgetStatTile
          label={t("income")} icon={TrendUpIcon} isLoading={false}
          previsto={budget.totals.income.previsto} realizado={budget.totals.income.realizado}
          tone={budgetLineTone("income", budget.totals.income.previsto, budget.totals.income.realizado)}
          previstoLabel={t("card.previsto")} diffLabel={t("card.diff")} percentLabel={t("card.percent")}
        />
        <BudgetStatTile
          label={t("expense")} icon={TrendDownIcon} isLoading={false}
          previsto={budget.totals.expense.previsto} realizado={budget.totals.expense.realizado}
          tone={budgetLineTone("expense", budget.totals.expense.previsto, budget.totals.expense.realizado)}
          previstoLabel={t("card.previsto")} diffLabel={t("card.diff")} percentLabel={t("card.percent")}
        />
        <BudgetStatTile
          label={t("result")} icon={ScalesIcon} isLoading={false}
          previsto={budget.totals.result.previsto} realizado={budget.totals.result.realizado}
          tone={resultTone}
          previstoLabel={t("card.previsto")} diffLabel={t("card.diff")} percentLabel={t("card.percent")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CategorySection
          type="income" lines={budget.income} uncategorized={budget.uncategorizedIncome} total={budget.totals.income}
          exerciceId={exerciceId} onAddCategory={() => setAddCategoryType("INCOME")}
        />
        <CategorySection
          type="expense" lines={budget.expense} uncategorized={budget.uncategorizedExpense} total={budget.totals.expense}
          exerciceId={exerciceId} onAddCategory={() => setAddCategoryType("EXPENSE")}
        />
      </div>

      <Modal open={addCategoryType !== null} onOpenChange={(open) => !open && setAddCategoryType(null)} title={t("addCategoryModalTitle")}>
        <FinanceCategoryForm
          defaultValues={{ type: addCategoryType ?? "INCOME" }}
          onSubmit={handleCreateCategory}
          onCancel={() => setAddCategoryType(null)}
          loading={createCategory.isPending}
        />
      </Modal>
    </div>
  )
}
