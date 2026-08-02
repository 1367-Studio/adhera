"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { LockIcon, LockOpenIcon, TrashIcon, CalendarIcon } from "@phosphor-icons/react/dist/ssr"
import { useExercices, useUpdateExercice, useDeleteExercice, type Exercice } from "@/hooks/use-exercices"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"

export function ExercicesView() {
  const t = useTranslations()
  const [closeTarget, setCloseTarget]   = useState<Exercice | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Exercice | null>(null)

  const { data: exercices = [], isLoading } = useExercices()
  const updateMutation = useUpdateExercice()
  const deleteMutation = useDeleteExercice()

  const fmtDate  = (d: string) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" })
  const fmtRange = (e: Exercice) => `${fmtDate(e.startDate)} – ${fmtDate(e.endDate)}`

  async function handleReopen(e: Exercice) {
    try {
      await updateMutation.mutateAsync({ id: e.id, data: { status: "OUVERT" } })
      toast.success(t("finances.exercicesView.toasts.reopened"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleClose() {
    if (!closeTarget) return
    try {
      await updateMutation.mutateAsync({ id: closeTarget.id, data: { status: "CLOTURE" } })
      toast.success(t("finances.exercicesView.toasts.closed"))
      setCloseTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("finances.exercicesView.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const columns: Column<Exercice>[] = [
    {
      key: "exercice",
      header: t("finances.exercicesView.columns.exercice"),
      cell: (e) => (
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <CalendarIcon className="size-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">{e.label}</p>
            <p className="text-xs text-muted-foreground">{fmtRange(e)}</p>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: t("finances.exercicesView.columns.status"),
      className: "w-28",
      cell: (e) => e.status === "OUVERT"
        ? <Badge variant="default" className="bg-green-600 hover:bg-green-700">{t("finances.exercicesView.status.ouvert")}</Badge>
        : <Badge variant="secondary">{t("finances.exercicesView.status.cloture")}</Badge>,
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (e) => (
        <RowActions actions={[
          e.status === "OUVERT"
            ? { label: t("finances.exercicesView.actions.close"),  icon: <LockIcon className="size-3.5" />,     onClick: () => setCloseTarget(e) }
            : { label: t("finances.exercicesView.actions.reopen"), icon: <LockOpenIcon className="size-3.5" />, onClick: () => handleReopen(e) },
          { label: t("finances.exercicesView.actions.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(e) },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.exercicesView.title")}
        description={t("finances.exercicesView.description")}
      />

      <DataTable
        columns={columns}
        data={exercices}
        loading={isLoading}
        keyExtractor={(e) => e.id}
        empty={t("finances.exercicesView.noExercices")}
      />

      <ConfirmDialog
        open={!!closeTarget}
        onOpenChange={(o) => !o && setCloseTarget(null)}
        title={t("finances.exercicesView.closeConfirmTitle")}
        description={closeTarget?.label ?? ""}
        confirmLabel={t("finances.exercicesView.actions.close")}
        loading={updateMutation.isPending}
        onConfirm={handleClose}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("finances.exercicesView.deleteConfirmTitle")}
        description={deleteTarget?.label ?? ""}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
