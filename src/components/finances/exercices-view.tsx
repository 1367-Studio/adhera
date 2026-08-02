"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, LockIcon, LockOpenIcon, TrashIcon, CalendarIcon } from "@phosphor-icons/react/dist/ssr"
import { useExercices, useCreateExercice, useUpdateExercice, useDeleteExercice, type Exercice, type ExerciceInput } from "@/hooks/use-exercices"
import { ApiError } from "@/lib/api-error"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { ExerciceForm } from "@/components/finances/exercice-form"

type GapWarning = { data: ExerciceInput; gapDays: number; gapStart: string; gapEnd: string }

export function ExercicesView() {
  const t = useTranslations()
  const [createOpen, setCreateOpen]     = useState(false)
  const [formDefaults, setFormDefaults] = useState<Partial<ExerciceInput> | undefined>(undefined)
  const [gapWarning, setGapWarning]     = useState<GapWarning | null>(null)
  const [closeTarget, setCloseTarget]   = useState<Exercice | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Exercice | null>(null)
  const [earlyClosureWarning, setEarlyClosureWarning] = useState<{ target: Exercice; endDate: string } | null>(null)


  const { data: exercices = [], isLoading } = useExercices()
  const createMutation = useCreateExercice()
  const updateMutation = useUpdateExercice()
  const deleteMutation = useDeleteExercice()

  const isFounding = exercices.length === 0

  const fmtDate  = (d: string) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" })
  const fmtRange = (e: Exercice) => `${fmtDate(e.startDate)} – ${fmtDate(e.endDate)}`

  // Not the authoritative rule (the server validates the real thing on submit) — just a
  // best-effort hint so the user isn't guessing blind. Reads month/day off whichever
  // exercice sorts first by startDate, which in practice is always the founding one.
  const fmtMonthDay = (d: string) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" })
  const patternHint = exercices.length > 0 ? `${fmtMonthDay(exercices[0].startDate)} – ${fmtMonthDay(exercices[0].endDate)}` : undefined

  function closeCreateModal() {
    setCreateOpen(false)
    setFormDefaults(undefined)
  }

  // Shared between the first attempt and the gap-confirmed retry — a PATTERN_MISMATCH
  // can surface on either one (e.g. gap-confirmed dates that also don't match the
  // established pattern), so both callers need the same auto-fill-and-explain handling.
  function handlePatternMismatch(err: unknown, data: ExerciceInput): boolean {
    if (!(err instanceof ApiError) || err.code !== "PATTERN_MISMATCH") return false
    const expectedStartDate = String(err.details?.expectedStartDate ?? "").slice(0, 10)
    const expectedEndDate   = String(err.details?.expectedEndDate ?? "").slice(0, 10)
    setFormDefaults({ label: data.label, startDate: expectedStartDate, endDate: expectedEndDate })
    toast.error(t("finances.exercicesView.patternMismatchHint", { start: fmtDate(expectedStartDate), end: fmtDate(expectedEndDate) }))
    return true
  }

  async function handleCreate(data: ExerciceInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("finances.exercicesView.toasts.created"))
      closeCreateModal()
      return
    } catch (err) {
      if (err instanceof ApiError && err.code === "GAP_WARNING") {
        setGapWarning({
          data,
          gapDays:  Number(err.details?.gapDays ?? 0),
          gapStart: String(err.details?.gapStart ?? ""),
          gapEnd:   String(err.details?.gapEnd ?? ""),
        })
        return
      }
      if (handlePatternMismatch(err, data)) return
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function confirmGapAndCreate() {
    if (!gapWarning) return
    const data = { ...gapWarning.data, confirmGap: true }
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("finances.exercicesView.toasts.created"))
      setGapWarning(null)
      closeCreateModal()
    } catch (err) {
      setGapWarning(null)
      if (handlePatternMismatch(err, gapWarning.data)) return
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

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
      if (err instanceof ApiError && err.code === "EARLY_CLOSURE") {
        setEarlyClosureWarning({ target: closeTarget, endDate: String(err.details?.endDate ?? "") })
        setCloseTarget(null)
        return
      }
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function confirmEarlyClosureAndClose() {
    if (!earlyClosureWarning) return
    try {
      await updateMutation.mutateAsync({
        id:   earlyClosureWarning.target.id,
        data: { status: "CLOTURE", confirmEarlyClosure: true },
      })
      toast.success(t("finances.exercicesView.toasts.closed"))
      setEarlyClosureWarning(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
      setEarlyClosureWarning(null)
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
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("finances.exercicesView.add")}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={exercices}
        loading={isLoading}
        keyExtractor={(e) => e.id}
        empty={t("finances.exercicesView.noExercices")}
      />

      <Modal open={createOpen} onOpenChange={(o) => !o && closeCreateModal()} title={t("finances.exercicesView.newExerciceTitle")} size="md" dismissable={false}>
        <ExerciceForm isFounding={isFounding} patternHint={patternHint} defaultValues={formDefaults} onSubmit={handleCreate} onCancel={closeCreateModal} loading={createMutation.isPending} />
      </Modal>

      <ConfirmDialog
        open={!!earlyClosureWarning}
        onOpenChange={(o) => !o && setEarlyClosureWarning(null)}
        title={t("finances.exercicesView.earlyClosureTitle")}
        description={earlyClosureWarning ? t("finances.exercicesView.earlyClosureDescription", { date: fmtDate(earlyClosureWarning.endDate) }) : ""}
        confirmLabel={t("finances.exercicesView.actions.close")}
        loading={updateMutation.isPending}
        onConfirm={confirmEarlyClosureAndClose}
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
