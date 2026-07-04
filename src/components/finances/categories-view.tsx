"use client"

import { useState } from "react"
import { toast } from "sonner"
import { PlusIcon, PencilIcon, Trash2Icon, SparklesIcon } from "lucide-react"
import { useFinanceCategories, useCreateFinanceCategory, useUpdateFinanceCategory, useDeleteFinanceCategory, useSeedFinanceCategories } from "@/hooks/use-finance-categories"
import type { FinanceCategoryInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FinanceCategoryForm } from "@/components/finances/finance-category-form"

type Category = {
  id:            string
  name:          string
  type:          "INCOME" | "EXPENSE"
  accountingCode: string | null
  isDefault:     boolean
  _count?:       { incomes: number; expenses: number }
}

function CategoryList({ categories, loading, onEdit, onDelete }: {
  categories: Category[]
  loading:    boolean
  onEdit:     (c: Category) => void
  onDelete:   (c: Category) => void
}) {
  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/30 animate-pulse" />)}</div>
  }
  if (!categories.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Aucune catégorie</p>
  }
  return (
    <ul className="space-y-1">
      {categories.map(c => (
        <li key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">{c.name}</span>
            {c.accountingCode && <span className="text-xs text-muted-foreground">{c.accountingCode}</span>}
            {c.isDefault && <Badge variant="outline" className="text-xs">Défaut</Badge>}
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="size-7" onClick={() => onEdit(c)}>
              <PencilIcon className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7 text-destructive hover:text-destructive" onClick={() => onDelete(c)}>
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function CategoriesView() {
  const [createOpen, setCreateOpen]         = useState(false)
  const [createType, setCreateType]         = useState<"INCOME" | "EXPENSE">("INCOME")
  const [editTarget, setEditTarget]         = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget]     = useState<Category | null>(null)

  const { data: incomeCategories = [], isLoading: loadingI } = useFinanceCategories("INCOME")
  const { data: expenseCategories = [], isLoading: loadingE } = useFinanceCategories("EXPENSE")

  const createMutation = useCreateFinanceCategory()
  const updateMutation = useUpdateFinanceCategory(editTarget?.id ?? "")
  const deleteMutation = useDeleteFinanceCategory()
  const seedMutation   = useSeedFinanceCategories()

  async function handleCreate(data: FinanceCategoryInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Catégorie créée")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: FinanceCategoryInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Catégorie mise à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Catégorie supprimée")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleSeed() {
    try {
      const res = await seedMutation.mutateAsync()
      toast.success(`${res.created} catégorie(s) initialisée(s)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Catégories"
        description="Gérez les catégories de recettes et de dépenses."
        action={
          <Button size="sm" variant="outline" onClick={handleSeed} loading={seedMutation.isPending}>
            <SparklesIcon className="mr-1.5 size-4" />
            Initialiser les catégories par défaut
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-green-700 dark:text-green-400">Recettes</h3>
            <Button size="sm" variant="ghost" onClick={() => { setCreateType("INCOME"); setCreateOpen(true) }}>
              <PlusIcon className="size-4" />
            </Button>
          </div>
          <CategoryList categories={incomeCategories as Category[]} loading={loadingI} onEdit={setEditTarget} onDelete={setDeleteTarget} />
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-red-700 dark:text-red-400">Dépenses</h3>
            <Button size="sm" variant="ghost" onClick={() => { setCreateType("EXPENSE"); setCreateOpen(true) }}>
              <PlusIcon className="size-4" />
            </Button>
          </div>
          <CategoryList categories={expenseCategories as Category[]} loading={loadingE} onEdit={setEditTarget} onDelete={setDeleteTarget} />
        </div>
      </div>

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="Nouvelle catégorie" size="sm" dismissable={false}>
        <FinanceCategoryForm
          defaultValues={{ type: createType }}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} title="Modifier la catégorie" size="sm" dismissable={false}>
        <FinanceCategoryForm
          defaultValues={editTarget ? { name: editTarget.name, type: editTarget.type, accountingCode: editTarget.accountingCode ?? "" } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer cette catégorie ?"
        description={(() => {
          const uses = (deleteTarget?._count?.incomes ?? 0) + (deleteTarget?._count?.expenses ?? 0)
          return uses > 0
            ? `« ${deleteTarget?.name} » est utilisée par ${uses} recette${uses > 1 ? "s" : ""}/dépense${uses > 1 ? "s" : ""}. Ces entrées passeront en « Non catégorisé ».`
            : deleteTarget?.name ?? ""
        })()}
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
