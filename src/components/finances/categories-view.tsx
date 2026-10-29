"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, TrashIcon, SparkleIcon } from "@phosphor-icons/react/dist/ssr";
import { useFinanceCategories, useCreateFinanceCategory, useUpdateFinanceCategory, useDeleteFinanceCategory, useReactivateFinanceCategory, useSeedFinanceCategories } from "@/hooks/use-finance-categories"
import type { FinanceCategoryInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { FinanceCategoryForm } from "@/components/finances/finance-category-form"
import { useHasAccess } from "@/lib/user-context"

type Category = {
  id:            string
  name:          string
  type:          "INCOME" | "EXPENSE"
  accountingCode: string | null
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
  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/30 animate-pulse" />)}</div>
  }
  if (!categories.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">{t("noCategories")}</p>
  }
  return (
    <ul className="space-y-1">
      {categories.map(c => (
        <li key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={c.archivedAt ? "font-medium text-muted-foreground" : "font-medium"}>{c.name}</span>
            {c.accountingCode && <span className="text-xs text-muted-foreground">{c.accountingCode}</span>}
            <span className="text-xs text-muted-foreground">{tc(`sectionOptions.${c.section}`)}</span>
            {c.isDefault && <Badge variant="outline">{t("default")}</Badge>}
            {c.archivedAt && <span className="text-xs text-muted-foreground">{t("archived")}</span>}
          </div>
          {canEdit && (
            <div className="flex items-center gap-1">
              {c.archivedAt ? (
                <Button size="sm" variant="ghost" onClick={() => onReactivate(c)}>{t("reactivate")}</Button>
              ) : (
                <>
                  <Button size="icon-sm" variant="ghost" onClick={() => onEdit(c)}>
                    <PencilSimpleIcon className="size-3.5" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(c)}>
                    <TrashIcon className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function CategoriesView() {
  const t = useTranslations()
  // FORM-34: a Comptabilité reader sees the categories but cannot seed, add, edit or delete them.
  const canEditComptabilite = useHasAccess("comptabilite", "edit")
  const [createOpen, setCreateOpen]         = useState(false)
  const [createType, setCreateType]         = useState<"INCOME" | "EXPENSE">("INCOME")
  const [editTarget, setEditTarget]         = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget]     = useState<Category | null>(null)
  const [showArchived, setShowArchived]     = useState(false)

  const { data: incomeCategories = [], isLoading: loadingI } = useFinanceCategories("INCOME", showArchived)
  const { data: expenseCategories = [], isLoading: loadingE } = useFinanceCategories("EXPENSE", showArchived)

  // Archived categories excluded even when "mostrar arquivadas" is on — an archived category
  // isn't really "in use" going forward, so warning about reusing its code would be misleading.
  const allAccountingCodes = [...(incomeCategories as Category[]), ...(expenseCategories as Category[])]
    .filter(c => !c.archivedAt)
    .map(c => c.accountingCode)
    .filter((code): code is string => Boolean(code))

  const createMutation     = useCreateFinanceCategory()
  const updateMutation     = useUpdateFinanceCategory(editTarget?.id ?? "")
  const deleteMutation     = useDeleteFinanceCategory()
  const reactivateMutation = useReactivateFinanceCategory()
  const seedMutation       = useSeedFinanceCategories()

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
              <Button size="icon-sm" variant="ghost" onClick={() => { setCreateType("INCOME"); setCreateOpen(true) }}>
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
              <Button size="icon-sm" variant="ghost" onClick={() => { setCreateType("EXPENSE"); setCreateOpen(true) }}>
                <PlusIcon className="size-4" />
              </Button>
            )}
          </div>
          <CategoryList categories={expenseCategories as Category[]} loading={loadingE} canEdit={canEditComptabilite} onEdit={setEditTarget} onDelete={setDeleteTarget} onReactivate={handleReactivate} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("finances.categoriesView.transferLimitationNote")}</p>

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("finances.categoriesView.newCategoryTitle")} size="sm" dismissable={false}>
        <FinanceCategoryForm
          defaultValues={{ type: createType }}
          takenAccountingCodes={allAccountingCodes}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} title={t("finances.categoriesView.editCategoryTitle")} size="sm" dismissable={false}>
        <FinanceCategoryForm
          defaultValues={editTarget ? { name: editTarget.name, type: editTarget.type, accountingCode: editTarget.accountingCode ?? "", section: editTarget.section } : undefined}
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
