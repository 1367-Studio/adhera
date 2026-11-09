"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, TrashIcon, ArrowCounterClockwiseIcon, SparkleIcon } from "@phosphor-icons/react/dist/ssr";
import { useFinanceCategories, useCreateFinanceCategory, useUpdateFinanceCategory, useDeleteFinanceCategory, useReactivateFinanceCategory, useSeedFinanceCategories } from "@/hooks/use-finance-categories"
import type { FinanceCategoryInput } from "@/lib/schemas"
import type { DefaultFinanceCategory } from "@/lib/finance/default-categories"
import { normalizeAccountingCode, labelForAccountCode } from "@/lib/finance/chart-of-accounts"
import { PageHeader } from "@/components/ui/page-header"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { RowActions } from "@/components/ui/row-actions"
import { FinanceCategoryForm } from "@/components/finances/finance-category-form"
import { CategoryTemplatePicker } from "@/components/finances/category-template-picker"
import { useHasAccess } from "@/lib/user-context"

export type Category = {
  id:            string
  name:          string
  type:          "INCOME" | "EXPENSE"
  accountingCode: string | null
  description:   string | null
  key:           string | null
  section:       "OPERATING" | "FINANCIAL" | "EXCEPTIONAL" | "OTHER" | "IN_KIND" | "IMMOBILISATION"
  isDefault:     boolean
  archivedAt:    string | null
  _count?:       { incomes: number; expenses: number; budgetLines: number; boutiqueProduits: number; boutiqueCommandeItems: number; materials: number }
}

function CategoryList({ categories, loading, canEdit, onEdit, onDelete, onReactivate }: {
  categories: Category[]
  loading:    boolean
  canEdit:    boolean
  onEdit:     (c: Category) => void
  onDelete:   (c: Category) => void
  onReactivate: (c: Category) => void
}) {
  const t  = useTranslations("finances.categoriesView")
  const tc = useTranslations("finances.categoryForm")
  const tCommon = useTranslations("common")
  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/30 animate-pulse" />)}</div>
  }
  if (!categories.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">{t("noCategories")}</p>
  }
  return (
    <ul className="space-y-1">
      {categories.map(c => {
        const code  = c.accountingCode ? normalizeAccountingCode(c.accountingCode) : null
        const label = c.accountingCode ? labelForAccountCode(c.accountingCode) : null
        return (
          <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className={c.archivedAt ? "font-medium text-muted-foreground" : "font-medium"}>{c.name}</span>
                {/* OPERATING is the default/expected section for virtually every current-use
                    category (the two IMMOBILISATION defaults were deliberately removed from
                    the standard catalog — see default-categories.ts) — badging it on every
                    single row is pure repetition, not a semantic signal. Only a genuinely
                    exceptional section (a custom category pointing at FINANCIAL/EXCEPTIONAL/
                    IMMOBILISATION/IN_KIND/OTHER) is worth calling out. */}
                {c.section !== "OPERATING" && <Badge variant="outline">{tc(`sectionOptions.${c.section}`)}</Badge>}
                {c.isDefault && <span className="text-xs text-muted-foreground">{t("default")}</span>}
                {c.archivedAt && <span className="text-xs text-muted-foreground">{t("archived")}</span>}
              </div>
              {code && <p className="text-xs text-muted-foreground">{code}{label ? ` — ${label}` : ""}</p>}
              {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
            </div>
            {canEdit && (
              <RowActions actions={
                c.archivedAt
                  ? [{ label: t("reactivate"), icon: <ArrowCounterClockwiseIcon className="size-3.5" />, onClick: () => onReactivate(c) }]
                  : [
                      { label: tCommon("edit"), icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => onEdit(c) },
                      { label: tCommon("delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => onDelete(c) },
                    ]
              } />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function CategoriesView() {
  const t = useTranslations()
  // FORM-34: a Comptabilité reader sees the categories but cannot seed, add, edit or delete them.
  const canEditComptabilite = useHasAccess("comptabilite", "edit")
  const [pickerOpen, setPickerOpen]         = useState(false)
  const [createOpen, setCreateOpen]         = useState(false)
  const [createType, setCreateType]         = useState<"INCOME" | "EXPENSE">("INCOME")
  const [createPrefill, setCreatePrefill]   = useState<Partial<FinanceCategoryInput>>({})
  const [suggestedCodes, setSuggestedCodes] = useState<string[]>([])
  const [editTarget, setEditTarget]         = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget]     = useState<Category | null>(null)
  const [showArchived, setShowArchived]     = useState(false)

  const { data: incomeCategories = [], isLoading: loadingI } = useFinanceCategories("INCOME", showArchived)
  const { data: expenseCategories = [], isLoading: loadingE } = useFinanceCategories("EXPENSE", showArchived)
  // Independent of the "Afficher les catégories archivées" display toggle above — the template
  // picker needs to know about EVERY category (incl. archived) regardless of what the list is
  // currently showing, so it can route "Billetterie" to the existing row (active: edit it,
  // archived: offer to reactivate it) instead of only ever disabling the button.
  const { data: allIncomeCategories = [] }  = useFinanceCategories("INCOME", true)
  const { data: allExpenseCategories = [] } = useFinanceCategories("EXPENSE", true)

  // Archived categories excluded even when "mostrar arquivadas" is on — an archived category
  // isn't really "in use" going forward, so warning about reusing its code would be misleading.
  const activeCategories = [...(incomeCategories as Category[]), ...(expenseCategories as Category[])].filter(c => !c.archivedAt)
  const allAccountingCodes = activeCategories.map(c => c.accountingCode).filter((code): code is string => Boolean(code))
  const categoriesByKey = useMemo(() => {
    const all = [...(allIncomeCategories as Category[]), ...(allExpenseCategories as Category[])]
    return new Map(all.filter((c): c is Category & { key: string } => Boolean(c.key)).map(c => [c.key, c]))
  }, [allIncomeCategories, allExpenseCategories])

  const createMutation     = useCreateFinanceCategory()
  const updateMutation     = useUpdateFinanceCategory(editTarget?.id ?? "")
  const deleteMutation     = useDeleteFinanceCategory()
  const reactivateMutation = useReactivateFinanceCategory()
  const seedMutation       = useSeedFinanceCategories()

  function openPicker(type: "INCOME" | "EXPENSE") {
    setCreateType(type)
    setPickerOpen(true)
  }

  function handleSelectTemplate(template: DefaultFinanceCategory) {
    setCreatePrefill({ name: template.name, type: template.type, accountingCode: template.accountingCode, description: template.description })
    setSuggestedCodes([template.accountingCode, ...(template.alternativeAccountingCodes ?? [])])
    setPickerOpen(false)
    setCreateOpen(true)
  }

  function handleSelectCustom() {
    setCreatePrefill({ type: createType })
    setSuggestedCodes([])
    setPickerOpen(false)
    setCreateOpen(true)
  }

  function handleSelectExisting(category: Category) {
    setPickerOpen(false)
    setEditTarget(category)
  }

  async function handleReactivateFromPicker(category: Category) {
    try {
      await reactivateMutation.mutateAsync(category.id)
      toast.success(t("finances.categoriesView.toasts.reactivated"))
      setPickerOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCreate(data: FinanceCategoryInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("finances.categoriesView.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: FinanceCategoryInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("finances.categoriesView.toasts.updated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const { archived } = await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(archived ? t("finances.categoriesView.toasts.archived") : t("finances.categoriesView.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleReactivate(category: Category) {
    try {
      await reactivateMutation.mutateAsync(category.id)
      toast.success(t("finances.categoriesView.toasts.reactivated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleSeed() {
    try {
      const res = await seedMutation.mutateAsync()
      toast.success(t("finances.categoriesView.toasts.seeded", { count: res.created }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.categoriesView.title")}
        description={t("finances.categoriesView.description")}
        action={canEditComptabilite && (
          <Button size="sm" variant="outline" onClick={handleSeed} loading={seedMutation.isPending}>
            <SparkleIcon className="mr-1.5 size-4" />
            {t("finances.categoriesView.seedButton")}
          </Button>
        )}
      />

      <CheckboxField
        label={t("finances.categoriesView.showArchived")}
        checked={showArchived}
        onChange={e => setShowArchived(e.target.checked)}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-green-700 dark:text-green-400">{t("finances.categoriesView.income")}</h3>
            {canEditComptabilite && (
              <Button size="icon-sm" variant="ghost" onClick={() => openPicker("INCOME")}>
                <PlusIcon className="size-4" />
              </Button>
            )}
          </div>
          <CategoryList categories={incomeCategories as Category[]} loading={loadingI} canEdit={canEditComptabilite} onEdit={setEditTarget} onDelete={setDeleteTarget} onReactivate={handleReactivate} />
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-red-700 dark:text-red-400">{t("finances.categoriesView.expenses")}</h3>
            {canEditComptabilite && (
              <Button size="icon-sm" variant="ghost" onClick={() => openPicker("EXPENSE")}>
                <PlusIcon className="size-4" />
              </Button>
            )}
          </div>
          <CategoryList categories={expenseCategories as Category[]} loading={loadingE} canEdit={canEditComptabilite} onEdit={setEditTarget} onDelete={setDeleteTarget} onReactivate={handleReactivate} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("finances.categoriesView.transferLimitationNote")}</p>

      <Modal open={pickerOpen} onOpenChange={setPickerOpen} title={t("finances.categoriesView.chooseTemplateTitle")} size="sm">
        <CategoryTemplatePicker
          type={createType}
          categoriesByKey={categoriesByKey}
          onSelectTemplate={handleSelectTemplate}
          onSelectExisting={handleSelectExisting}
          onReactivate={handleReactivateFromPicker}
          onSelectCustom={handleSelectCustom}
        />
      </Modal>

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("finances.categoriesView.newCategoryTitle")} size="sm" dismissable={false}>
        <FinanceCategoryForm
          defaultValues={createPrefill}
          takenAccountingCodes={allAccountingCodes}
          suggestedAccountingCodes={suggestedCodes}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} title={t("finances.categoriesView.editCategoryTitle")} size="sm" dismissable={false}>
        <FinanceCategoryForm
          defaultValues={editTarget ? { name: editTarget.name, type: editTarget.type, accountingCode: editTarget.accountingCode ?? "", description: editTarget.description ?? "", section: editTarget.section } : undefined}
          takenAccountingCodes={allAccountingCodes.filter(code => code !== editTarget?.accountingCode)}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={(() => {
          const uses = Object.values(deleteTarget?._count ?? {}).reduce((sum, n) => sum + n, 0)
          return uses > 0 ? t("finances.categoriesView.archiveConfirmTitle") : t("finances.categoriesView.deleteConfirmTitle")
        })()}
        description={(() => {
          const uses = Object.values(deleteTarget?._count ?? {}).reduce((sum, n) => sum + n, 0)
          return uses > 0
            ? t("finances.categoriesView.archiveConfirmInUse", { name: deleteTarget?.name ?? "", count: uses })
            : deleteTarget?.name ?? ""
        })()}
        confirmLabel={(() => {
          const uses = Object.values(deleteTarget?._count ?? {}).reduce((sum, n) => sum + n, 0)
          return uses > 0 ? t("finances.categoriesView.archive") : t("common.delete")
        })()}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
