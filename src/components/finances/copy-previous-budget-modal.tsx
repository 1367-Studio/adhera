"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { useBudgetProjects, useCopyBudget } from "@/hooks/use-budget"
import { ApiError } from "@/lib/api-error"

interface CopyPreviousBudgetModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetExerciceId: string
  targetExerciceLabel: string
  previousExerciceLabel: string
}

// "Copier le budget précédent" — copies BudgetLine forecasts only (never Income/Expense), from
// the exercice right before the one currently selected (see findPreviousExercice). The "sans
// projet" lines are always copied; which projects' own lines come along is the user's choice
// here (checkboxes, or "tous"). A conflict (the target already has non-zero forecasts) asks to
// confirm before overwriting — see budgetCopySchema's doc comment in src/lib/schemas/budget.ts.
export function CopyPreviousBudgetModal({ open, onOpenChange, targetExerciceId, targetExerciceLabel, previousExerciceLabel }: CopyPreviousBudgetModalProps) {
  const t = useTranslations("finances.previsionnel.copyBudget")
  const tCommon = useTranslations("common")

  const { data: projects = [] } = useBudgetProjects(true)
  const [selectAll, setSelectAll] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  const copyBudget = useCopyBudget()

  function reset() {
    setSelectAll(true)
    setSelectedIds(new Set())
    setConfirmOpen(false)
  }

  function handleClose(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function toggleProject(id: string, checked: boolean) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function runCopy(confirmOverwrite: boolean) {
    try {
      const result = await copyBudget.mutateAsync({
        targetExerciceId,
        projectIds: selectAll ? "all" : Array.from(selectedIds),
        confirmOverwrite,
      })
      toast.success(t("toasts.copied", { count: result.copied }))
      handleClose(false)
    } catch (err) {
      if (err instanceof ApiError && err.details?.conflict === true) {
        setConfirmOpen(true)
        return
      }
      toast.error(err instanceof Error ? err.message : t("toasts.error"))
    }
  }

  return (
    <>
      <Modal open={open && !confirmOpen} onOpenChange={handleClose} title={t("modalTitle")} description={t("modalDescription", { previous: previousExerciceLabel, target: targetExerciceLabel })}>
        <div className="space-y-4">
          <CheckboxField
            label={t("allProjects")}
            checked={selectAll}
            onChange={e => setSelectAll(e.target.checked)}
          />
          {!selectAll && (
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
              ) : (
                projects.map(p => (
                  <CheckboxField
                    key={p.id}
                    label={p.archivedAt ? `${p.name} (${t("archived")})` : p.name}
                    checked={selectedIds.has(p.id)}
                    onChange={e => toggleProject(p.id, e.target.checked)}
                  />
                ))
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("noProjectAlwaysCopied")}</p>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>{tCommon("cancel")}</Button>
            <Button type="button" loading={copyBudget.isPending} onClick={() => runCopy(false)}>{t("copy")}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("confirmOverwriteTitle")}
        description={t("confirmOverwriteDescription")}
        confirmLabel={t("confirmOverwriteAction")}
        confirmVariant="default"
        loading={copyBudget.isPending}
        onConfirm={() => runCopy(true)}
      />
    </>
  )
}
