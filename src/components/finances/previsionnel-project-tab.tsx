"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  CaretRightIcon, PlusIcon, TrendUpIcon, TrendDownIcon, ScalesIcon,
  PencilSimpleIcon, ArchiveIcon, ArrowCounterClockwiseIcon, DownloadSimpleIcon, CaretDownIcon, TrashIcon,
} from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { EmptyState } from "@/components/ui/empty-state"
import { RowActions } from "@/components/ui/row-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { BudgetStatTile } from "@/components/finances/budget-stat-tile"
import { BudgetProjectForm } from "@/components/finances/budget-project-form"
import { AddCategoryToProjectModal } from "@/components/finances/add-category-to-project-modal"
import { TransactionDrillDownModal, type DrillDown } from "@/components/finances/transaction-drill-down"
import { fmtBudgetCurrency as fmt, DiffPercentCell, InlineAmountCell } from "@/components/finances/budget-table-cells"
import { exportBudgetExcel } from "@/components/finances/previsionnel-global-tab"
import { buildBudgetExportRows } from "@/lib/finance/budget-export-shared"
import { sanitizeForFilename } from "@/lib/finance/income-statement-shared"
import { exportBudgetPdf } from "@/lib/pdf/budget-pdf-client"
import {
  useBudgetProjects, useProjectBudget, useCreateBudgetProject, useUpdateBudgetProject, useUpsertBudgetLine, useDeleteBudgetLine,
  type BudgetProjectSummary,
} from "@/hooks/use-budget"
import { budgetLineTone, budgetResultTone } from "@/lib/finance/budget-format"
import type { BudgetCategoryLine, BudgetPeriod, BudgetUncategorizedBucket } from "@/lib/finance/budget-shared"
import type { BudgetProjectInput } from "@/lib/schemas"
import { cn } from "@/lib/utils"

function ProjectCategoryRow({ line, type, exerciceId, projectId }: {
  line:       BudgetCategoryLine
  type:       "income" | "expense"
  exerciceId: string
  projectId:  string
}) {
  const t = useTranslations("finances.previsionnel")
  const tp = useTranslations("finances.previsionnel.projectsTab")
  const upsert = useUpsertBudgetLine()
  const remove = useDeleteBudgetLine()
  const tone = budgetLineTone(type, line.previsto, line.realizado)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)

  async function save(amount: number) {
    try {
      await upsert.mutateAsync({ exerciceId, categoryId: line.categoryId, projectId, amount })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.updateError"))
    }
  }

  async function handleRemove() {
    try {
      await remove.mutateAsync({ exerciceId, categoryId: line.categoryId, projectId })
      toast.success(tp("toasts.categoryRemoved"))
      setConfirmRemoveOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.updateError"))
    }
  }

  return (
    <>
      <tr className="group/row border-b last:border-0">
        <td className="py-2 pl-4 pr-3">{line.name}</td>
        <td className="py-2 px-3 text-right w-32"><InlineAmountCell value={line.previsto} onSave={save} /></td>
        <td className="py-2 px-3 text-right w-32 tabular-nums">{fmt(line.realizado)}</td>
        <td className="py-2 pr-2 pl-3 text-right w-40"><DiffPercentCell previsto={line.previsto} realizado={line.realizado} tone={tone} /></td>
        <td className="py-2 pr-3 w-9">
          <Button
            type="button" variant="ghost" size="icon-sm"
            className="opacity-0 group-hover/row:opacity-100"
            onClick={() => setConfirmRemoveOpen(true)}
          >
            <TrashIcon className="size-3.5" />
            <span className="sr-only">{tp("removeCategoryFromProject")}</span>
          </Button>
        </td>
      </tr>
      <ConfirmDialog
        open={confirmRemoveOpen}
        onOpenChange={setConfirmRemoveOpen}
        title={tp("removeCategoryConfirmTitle")}
        description={tp("removeCategoryConfirmDescription", { category: line.name })}
        confirmLabel={tp("removeCategoryFromProject")}
        loading={remove.isPending}
        onConfirm={handleRemove}
      />
    </>
  )
}

function ProjectCategorySection({ type, lines, uncategorized, total, exerciceId, projectId, onOpenUncategorized }: {
  type:          "income" | "expense"
  lines:         BudgetCategoryLine[]
  uncategorized: BudgetUncategorizedBucket
  total:         { previsto: number; realizado: number }
  exerciceId:    string
  projectId:     string
  onOpenUncategorized: () => void
}) {
  const t = useTranslations("finances.previsionnel")
  const titleColor = type === "income" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
  const tone = budgetLineTone(type, total.previsto, total.realizado)

  return (
    <div className="min-w-0">
      <h4 className={cn("text-sm font-semibold mb-2", titleColor)}>{t(type)}</h4>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="py-2 pl-4 pr-3 text-left font-medium text-muted-foreground">{t("columns.category")}</th>
              <th className="py-2 px-3 text-right font-medium text-muted-foreground w-32">{t("columns.previsto")}</th>
              <th className="py-2 px-3 text-right font-medium text-muted-foreground w-32">{t("columns.realizado")}</th>
              <th className="py-2 pr-2 pl-3 text-right font-medium text-muted-foreground w-40">{t("columns.diffPercent")}</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && uncategorized.count === 0 ? (
              <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">{t("noCategories")}</td></tr>
            ) : (
              <>
                {lines.map(line => <ProjectCategoryRow key={line.categoryId} line={line} type={type} exerciceId={exerciceId} projectId={projectId} />)}
                {uncategorized.count > 0 && (
                  <tr className="border-b last:border-0 text-muted-foreground">
                    <td className="py-2 pl-4 pr-3">
                      <button type="button" onClick={onOpenUncategorized} className="hover:text-foreground hover:underline">
                        {t("uncategorized")} ({uncategorized.count})
                      </button>
                    </td>
                    <td className="py-2 px-3 text-right w-32">—</td>
                    <td className="py-2 px-3 text-right w-32 tabular-nums">{fmt(uncategorized.realizado)}</td>
                    <td className="py-2 pr-2 pl-3" />
                    <td className="py-2 pr-3" />
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
              <td className="py-2 pr-2 pl-3 text-right w-40"><DiffPercentCell previsto={total.previsto} realizado={total.realizado} tone={tone} /></td>
              <td className="py-2 pr-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// One project's collapsed-by-default block — see PrevisionnelProjectTab's doc comment below
// for why the project's own budget is only fetched once expanded.
function ProjectBlock({ project, exerciceId }: { project: BudgetProjectSummary; exerciceId: string }) {
  const t  = useTranslations("finances.previsionnel.projectsTab")
  const tg = useTranslations("finances.previsionnel")
  const tr = useTranslations("finances.compteResultat")

  const [expanded, setExpanded]               = useState(false)
  const [editOpen, setEditOpen]               = useState(false)
  const [addCategoryOpen, setAddCategoryOpen] = useState(false)
  const [drillDown, setDrillDown]             = useState<DrillDown | null>(null)

  // `enabled: expanded` — a collapsed project never fetches its budget, since the spec keeps
  // every block collapsed by default and most associations will have several projects.
  const { data, isLoading } = useProjectBudget(project.id, exerciceId, expanded)
  const budget = data?.budget ?? null

  const updateProject = useUpdateBudgetProject()

  async function toggleArchive() {
    try {
      await updateProject.mutateAsync({ id: project.id, data: { archived: !project.archivedAt } })
      toast.success(project.archivedAt ? t("toasts.unarchived") : t("toasts.archived"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tg("toasts.updateError"))
    }
  }

  async function handleEdit(input: BudgetProjectInput) {
    try {
      await updateProject.mutateAsync({ id: project.id, data: input })
      toast.success(t("toasts.updated"))
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tg("toasts.updateError"))
    }
  }

  const existingCategoryIds = new Set(budget ? [...budget.income, ...budget.expense].map(l => l.categoryId) : [])

  function exportLabels() {
    return { income: tg("income"), expense: tg("expense"), uncategorized: tg("uncategorized"), total: tg("columns.total"), result: tg("result") }
  }

  function handleExportExcel(current: BudgetPeriod) {
    exportBudgetExcel(current, `budget-previsionnel-${sanitizeForFilename(project.name)}`, {
      ...exportLabels(),
      sheetName: project.name.slice(0, 31),
      headers: {
        category: tg("columns.category"), previsto: tg("columns.previsto"), realizado: tg("columns.realizado"),
        diff: tg("export.diffColumn"), percent: tg("export.percentColumn"),
        association: tg("export.associationLabel"), exercice: tg("export.exerciceLabel"),
      },
    })
  }

  function handleExportPdf(current: BudgetPeriod) {
    exportBudgetPdf({
      title:            `${tg("title")} — ${project.name}`,
      exerciceLabel:    current.exercice!.label,
      previstoLabel:    tg("columns.previsto"),
      realizadoLabel:   tg("columns.realizado"),
      diffPercentLabel: tg("columns.diffPercent"),
      rows:             buildBudgetExportRows(current, exportLabels()),
      fileNameSuffix:   `${sanitizeForFilename(project.name)}-${sanitizeForFilename(current.exercice!.label)}`,
    })
  }

  return (
    <div className="border-b last:border-0">
      <div className="flex items-center justify-between gap-2 py-3 px-4">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground"
        >
          <CaretRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
          <span className="truncate font-medium">{project.name}</span>
          {project.archivedAt && <span className="shrink-0 text-xs text-muted-foreground">({t("archived")})</span>}
        </button>
        <RowActions actions={[
          { label: t("editProject"), icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditOpen(true) },
          {
            label: project.archivedAt ? t("unarchive") : t("archive"),
            icon:  project.archivedAt ? <ArrowCounterClockwiseIcon className="size-3.5" /> : <ArchiveIcon className="size-3.5" />,
            onClick: toggleArchive,
            separator: true,
          },
        ]} />
      </div>

      {expanded && (
        <div className="space-y-5 px-4 pb-5">
          {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}

          {isLoading || !budget ? (
            <div className="h-56 animate-pulse rounded-lg border bg-muted/30" />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <BudgetStatTile
                  label={tg("income")} icon={TrendUpIcon} isLoading={false}
                  previsto={budget.totals.income.previsto} realizado={budget.totals.income.realizado}
                  tone={budgetLineTone("income", budget.totals.income.previsto, budget.totals.income.realizado)}
                  previstoLabel={tg("card.previsto")} diffLabel={tg("card.diff")} percentLabel={tg("card.percent")}
                />
                <BudgetStatTile
                  label={tg("expense")} icon={TrendDownIcon} isLoading={false}
                  previsto={budget.totals.expense.previsto} realizado={budget.totals.expense.realizado}
                  tone={budgetLineTone("expense", budget.totals.expense.previsto, budget.totals.expense.realizado)}
                  previstoLabel={tg("card.previsto")} diffLabel={tg("card.diff")} percentLabel={tg("card.percent")}
                />
                <BudgetStatTile
                  label={tg("result")} icon={ScalesIcon} isLoading={false}
                  previsto={budget.totals.result.previsto} realizado={budget.totals.result.realizado}
                  tone={budgetResultTone(budget.totals.result.previsto, budget.totals.result.realizado)}
                  previstoLabel={tg("card.previsto")} diffLabel={tg("card.diff")} percentLabel={tg("card.percent")}
                />
              </div>

              <div className="flex items-center justify-between">
                <Button size="sm" variant="ghost" onClick={() => setAddCategoryOpen(true)}>
                  <PlusIcon className="mr-1.5 size-4" />
                  {t("addCategoryToProject")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                    <DownloadSimpleIcon className="mr-1.5 size-4" />
                    {tg("export.action")}
                    <CaretDownIcon className="ml-1 size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleExportExcel(budget)}>{tg("export.excel")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportPdf(budget)}>{tg("export.pdf")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <ProjectCategorySection
                  type="income" lines={budget.income} uncategorized={budget.uncategorizedIncome} total={budget.totals.income} exerciceId={exerciceId} projectId={project.id}
                  onOpenUncategorized={() => setDrillDown({ title: tr("uncategorized"), transactions: budget.uncategorizedIncome.transactions, type: "INCOME", categorizable: true })}
                />
                <ProjectCategorySection
                  type="expense" lines={budget.expense} uncategorized={budget.uncategorizedExpense} total={budget.totals.expense} exerciceId={exerciceId} projectId={project.id}
                  onOpenUncategorized={() => setDrillDown({ title: tr("uncategorized"), transactions: budget.uncategorizedExpense.transactions, type: "EXPENSE", categorizable: true })}
                />
              </div>
            </>
          )}
        </div>
      )}

      <Modal open={editOpen} onOpenChange={setEditOpen} title={t("editModalTitle")}>
        <BudgetProjectForm
          defaultValues={{ name: project.name, description: project.description ?? "" }}
          onSubmit={handleEdit}
          onCancel={() => setEditOpen(false)}
          loading={updateProject.isPending}
        />
      </Modal>

      {budget && (
        <AddCategoryToProjectModal
          open={addCategoryOpen}
          onOpenChange={setAddCategoryOpen}
          projectId={project.id}
          exerciceId={exerciceId}
          existingCategoryIds={existingCategoryIds}
        />
      )}

      <TransactionDrillDownModal
        drillDown={drillDown}
        onClose={() => setDrillDown(null)}
        // Every prefix that reads this same categoryId column — see the matching comment in
        // previsionnel-global-tab.tsx.
        invalidateKeys={[["budget-project"], ["budget-global"], ["compte-resultat"]]}
      />
    </div>
  )
}

// "Por projeto" tab — each BudgetProject gets its own collapsed-by-default block (never an
// accumulated summary across projects, per spec). Archived projects stay out of the list
// unless explicitly shown, so a long-finished project doesn't clutter the screen while its
// history (own exercices/BudgetLines) stays reachable.
export function PrevisionnelProjectTab({ exerciceId }: { exerciceId: string }) {
  const t = useTranslations("finances.previsionnel.projectsTab")

  const [createOpen, setCreateOpen]     = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  // Always fetches both active and archived projects — the "show archived" toggle filters
  // client-side. Fetching only active ones here (per `showArchived`) would mean the archived
  // count can never be known until after the toggle is already on, so the toggle itself would
  // never render.
  const { data: projects = [], isLoading } = useBudgetProjects(true)
  const createProject = useCreateBudgetProject()

  async function handleCreate(input: BudgetProjectInput) {
    try {
      await createProject.mutateAsync(input)
      toast.success(t("toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.createError"))
    }
  }

  const activeCount   = projects.filter(p => !p.archivedAt).length
  const archivedCount = projects.filter(p => p.archivedAt).length

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("count", { count: activeCount })}</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="mr-1.5 size-4" />
          {t("createProject")}
        </Button>
      </div>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg border bg-muted/30" />
      ) : activeCount === 0 && !showArchived ? (
        <EmptyState title={t("noProjects.title")} description={t("noProjects.description")} />
      ) : (
        <div className="rounded-lg border">
          {projects.filter(p => showArchived || !p.archivedAt).map(project => (
            <ProjectBlock key={project.id} project={project} exerciceId={exerciceId} />
          ))}
        </div>
      )}

      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived(s => !s)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {showArchived ? t("hideArchived") : t("showArchived", { count: archivedCount })}
        </button>
      )}

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("createModalTitle")}>
        <BudgetProjectForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createProject.isPending} />
      </Modal>
    </div>
  )
}
