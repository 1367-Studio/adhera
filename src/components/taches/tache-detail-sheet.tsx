"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import Link from "next/link"
import { PencilSimpleIcon, TrashIcon, TagIcon, UsersIcon, CalendarBlankIcon, BellIcon, LinkIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { useTache, useDeleteTache, useUpdateTache, type Tache, type TacheStatus } from "@/hooks/use-taches"
import { isTacheOverdue, tacheDueDateLocal } from "@/lib/tache-status"
import { useHasAccess } from "@/lib/user-context"
import { cn } from "@/lib/utils"

function membreName(m: { firstName: string; lastName: string }) {
  return `${m.firstName} ${m.lastName}`
}

function reminderLabel(t: ReturnType<typeof useTranslations>, r: { offsetDays: number; direction: "AVANT" | "APRES" }) {
  return r.direction === "AVANT"
    ? t("taches.detailSheet.reminderBefore", { count: r.offsetDays })
    : t("taches.detailSheet.reminderAfter", { count: r.offsetDays })
}

interface Props {
  tache:        Tache | null
  open:         boolean
  onOpenChange: (open: boolean) => void
  onEdit:       (tache: Tache) => void
}

export function TacheDetailSheet({ tache, open, onOpenChange, onEdit }: Props) {
  const t = useTranslations()
  const canEdit = useHasAccess("taches", "edit")
  const { data: detail, isLoading } = useTache(tache?.id ?? null)
  const current = detail ?? tache
  const deleteMutation = useDeleteTache()
  const updateMutation = useUpdateTache(current?.id ?? "")
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Confirmation uniquement pour la transition VERS Terminée (clôt la tâche pour tous les
  // assignés) — reprendre (Terminée → À faire/En cours) n'a plus besoin de confirmation
  // depuis qu'elle est réversible (voir reopenTache côté API).
  const [pendingComplete, setPendingComplete] = useState<TacheStatus | null>(null)

  async function applyStatus(status: TacheStatus) {
    if (!current) return
    try {
      await updateMutation.mutateAsync({ status })
      toast.success(status === "TERMINEE" ? t("taches.detailSheet.toasts.completed") : t("taches.detailSheet.toasts.statusUpdated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  function handleStatusChange(status: TacheStatus) {
    if (!current) return
    if (status === "TERMINEE" && current.status !== "TERMINEE") {
      setPendingComplete(status)
      return
    }
    applyStatus(status)
  }

  async function confirmComplete() {
    if (!pendingComplete) return
    await applyStatus(pendingComplete)
    setPendingComplete(null)
  }

  async function handleDelete() {
    if (!current) return
    try {
      await deleteMutation.mutateAsync(current.id)
      toast.success(t("taches.detailSheet.toasts.deleted"))
      setConfirmDelete(false)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const overdue = current ? isTacheOverdue(current) : false

  const statusOptions = [
    { value: "A_FAIRE" as const,  label: t("taches.status.aFaire") },
    { value: "EN_COURS" as const, label: t("taches.status.enCours") },
    { value: "TERMINEE" as const, label: t("taches.status.terminee") },
  ]

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0 overflow-hidden">
          <SheetHeader className="px-5 pt-10 pb-4 border-b shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-base font-semibold truncate">{current?.titre}</SheetTitle>
                {overdue && (
                  <div className="mt-1">
                    <Badge variant="destructive">
                      <WarningCircleIcon className="size-3" /> {t("taches.status.enRetard")}
                    </Badge>
                  </div>
                )}
              </div>
              {canEdit && current && (
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onEdit(current)}>
                    <PencilSimpleIcon className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
                    <TrashIcon className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {isLoading && !current ? (
              <div className="p-5 space-y-3">
                {[0, 1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : current ? (
              <div className="divide-y">
                <div className="px-5 py-4 space-y-3 text-sm">
                  {current.description && (
                    <p className="text-sm whitespace-pre-wrap">{current.description}</p>
                  )}
                  <div className="flex items-start gap-2">
                    <TagIcon className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{t("taches.detailSheet.categorie")}</span>
                    <span className="font-medium ml-auto">{current.categorie?.nom ?? t("taches.detailSheet.noCategorie")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <UsersIcon className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{t("taches.detailSheet.attribueeA")}</span>
                    <span className="font-medium ml-auto text-right">
                      {current.assignees.length === 0
                        ? t("taches.detailSheet.nonAttribuee")
                        : current.assignees.map(a => membreName(a.membre)).join(", ")}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CalendarBlankIcon className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{t("taches.detailSheet.echeance")}</span>
                    <span className={cn("font-medium ml-auto", overdue && "text-destructive")}>
                      {current.dueDate ? format(tacheDueDateLocal(current.dueDate), "EEEE d MMMM yyyy", { locale: fr }) : t("taches.detailSheet.sansEcheance")}
                    </span>
                  </div>
                  {current.reminders.length > 0 && (
                    <div className="flex items-start gap-2">
                      <BellIcon className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{t("taches.detailSheet.rappels")}</span>
                      <span className="font-medium ml-auto text-right">
                        {current.reminders.map(r => reminderLabel(t, r)).join(" · ")}
                      </span>
                    </div>
                  )}
                </div>

                {current.linkBackHref && (
                  <div className="px-5 py-4">
                    <Link href={current.linkBackHref} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                      <LinkIcon className="size-3.5" />
                      {current.linkBackLabel ?? t("taches.detailSheet.voirOrigine")}
                    </Link>
                  </div>
                )}

                {current.status === "TERMINEE" && current.completedAt && (
                  <div className="px-5 py-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircleIcon className="size-3.5 text-green-600 shrink-0" />
                    {current.completedBy
                      ? t("taches.detailSheet.completedByOn", { name: membreName(current.completedBy), date: format(new Date(current.completedAt), "d MMM yyyy", { locale: fr }) })
                      : t("taches.detailSheet.completedOn", { date: format(new Date(current.completedAt), "d MMM yyyy", { locale: fr }) })}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Contrôle de statut staff — remplace l'ancien bouton unique "Marquer comme
              terminée" : une tâche peut être reprise (Terminée → À faire/En cours), et un
              responsable peut refléter "En cours" sans dépendre du portail membre. */}
          {canEdit && current && (
            <div className="p-4 border-t shrink-0">
              <SegmentedControl
                options={statusOptions}
                value={current.status}
                onChange={handleStatusChange}
                disabled={updateMutation.isPending}
                className="w-full [&>button]:flex-1"
                ariaLabel={t("taches.detailSheet.statutLabel")}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("taches.detailSheet.deleteConfirmTitle")}
        description={t("taches.detailSheet.deleteConfirmDescription")}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!pendingComplete}
        onOpenChange={open => !open && setPendingComplete(null)}
        title={t("taches.detailSheet.completeConfirmTitle")}
        description={
          current && current.assignees.length > 1
            ? t("taches.detailSheet.completeConfirmDescriptionShared")
            : t("taches.detailSheet.completeConfirmDescription")
        }
        confirmLabel={t("taches.detailSheet.markComplete")}
        confirmVariant="default"
        loading={updateMutation.isPending}
        onConfirm={confirmComplete}
      />
    </>
  )
}
