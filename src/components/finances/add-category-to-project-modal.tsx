"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Modal } from "@/components/ui/modal"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { FinanceCategoryForm } from "@/components/finances/finance-category-form"
import { useFinanceCategories, useCreateFinanceCategory } from "@/hooks/use-finance-categories"
import { useUpsertBudgetLine } from "@/hooks/use-budget"
import type { FinanceCategoryInput } from "@/lib/schemas"

const NEW_CATEGORY = "__new__"

interface AddCategoryToProjectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  exerciceId: string
  // Categories already attached to this project (either type) — excluded from the picker so
  // the same category can't be linked to the project twice (see spec: "reutilizar as
  // categorias existentes e evitar duplicações").
  existingCategoryIds: Set<string>
}

// Reuses the existing FinanceCategory list (never duplicates it) — "Adicionar categoria ao
// projeto" is really just creating a zero-amount BudgetLine on this category+project, which is
// what makes that category appear in the project's own budget table (see computeBudgetPeriod's
// `relevantCategories` filter in src/lib/finance/budget.ts).
export function AddCategoryToProjectModal({ open, onOpenChange, projectId, exerciceId, existingCategoryIds }: AddCategoryToProjectModalProps) {
  const t = useTranslations("finances.previsionnel.projectsTab")
  const tCommon = useTranslations("common")

  const [type, setType] = useState<"INCOME" | "EXPENSE">("INCOME")
  const [categoryId, setCategoryId] = useState("")

  const { data: categories = [] } = useFinanceCategories(type)
  const availableCategories = (categories as { id: string; name: string }[]).filter(c => !existingCategoryIds.has(c.id))

  const createCategory = useCreateFinanceCategory()
  const upsertLine      = useUpsertBudgetLine()
  const qc = useQueryClient()

  function reset() {
    setType("INCOME")
    setCategoryId("")
  }

  function handleClose(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function attachCategory(id: string) {
    try {
      await upsertLine.mutateAsync({ exerciceId, categoryId: id, projectId, amount: 0 })
      await qc.invalidateQueries({ queryKey: ["budget-project", projectId] })
      toast.success(t("toasts.categoryAdded"))
      handleClose(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.updateError"))
    }
  }

  async function handleCreateCategory(input: FinanceCategoryInput) {
    try {
      const created = await createCategory.mutateAsync(input)
      await attachCategory(created.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.updateError"))
    }
  }

  const typeOptions = [
    { value: "INCOME",  label: t("typeIncome")  },
    { value: "EXPENSE", label: t("typeExpense") },
  ]
  const categoryOptions = [
    ...availableCategories.map(c => ({ value: c.id, label: c.name })),
    { value: NEW_CATEGORY, label: t("createNewCategory") },
  ]

  return (
    <Modal open={open} onOpenChange={handleClose} title={t("addCategoryModalTitle")}>
      {categoryId === NEW_CATEGORY ? (
        <FinanceCategoryForm
          defaultValues={{ type }}
          onSubmit={handleCreateCategory}
          onCancel={() => setCategoryId("")}
          loading={createCategory.isPending}
        />
      ) : (
        <div className="space-y-4">
          <SelectField
            label={t("type")}
            options={typeOptions}
            value={type}
            onValueChange={(v) => { setType(v as "INCOME" | "EXPENSE"); setCategoryId("") }}
          />
          <SelectField
            label={t("category")}
            options={categoryOptions}
            value={categoryId}
            onValueChange={setCategoryId}
            placeholder={t("selectCategoryPlaceholder")}
          />
          {availableCategories.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("noAvailableCategories")}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>{tCommon("cancel")}</Button>
            <Button
              type="button"
              disabled={!categoryId || upsertLine.isPending}
              loading={upsertLine.isPending}
              onClick={() => attachCategory(categoryId)}
            >
              {t("addCategoryToProject")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
