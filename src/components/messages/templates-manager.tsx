"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, PencilSimpleIcon, TrashIcon, FileTextIcon, CopyIcon, PauseCircleIcon, PlayCircleIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useMessageTemplates, useDeleteTemplate, useCreateTemplate, useToggleTemplateStatus,
  type MessageTemplate,
} from "@/hooks/use-message-templates"
import { TemplateModal } from "@/components/messages/template-modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { RowActions } from "@/components/ui/row-actions"
import { cn } from "@/lib/utils"
import { TEMPLATE_CATEGORY_LABELS } from "@/lib/automation"

export function TemplatesManager() {
  const { data: templates = [], isLoading } = useMessageTemplates()
  const deleteMut   = useDeleteTemplate()
  const createMut   = useCreateTemplate()
  const toggleMut   = useToggleTemplateStatus()

  const [modalOpen,      setModalOpen]      = useState(false)
  const [editTarget,     setEditTarget]     = useState<MessageTemplate | null>(null)
  const [deleteTarget,   setDeleteTarget]   = useState<MessageTemplate | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<MessageTemplate | null>(null)

  function openCreate() { setEditTarget(null); setModalOpen(true) }
  function openEdit(t: MessageTemplate) { setEditTarget(t); setModalOpen(true) }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMut.mutateAsync(deleteTarget.id)
      toast.success(`Modèle « ${deleteTarget.name} » supprimé`)
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function doToggle(t: MessageTemplate) {
    try {
      await toggleMut.mutateAsync({ id: t.id, active: !t.active })
      toast.success(t.active ? "Modèle désactivé" : "Modèle activé")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  function handleToggle(t: MessageTemplate) {
    // Deactivating silently stops every active rule that uses this template — confirm
    // when that's actually at stake. Reactivating has no downside, so it's immediate.
    if (t.active && t.activeRulesCount > 0) {
      setDeactivateTarget(t)
      return
    }
    doToggle(t)
  }

  async function handleConfirmDeactivate() {
    if (!deactivateTarget) return
    await doToggle(deactivateTarget)
    setDeactivateTarget(null)
  }

  async function handleDuplicate(t: MessageTemplate) {
    try {
      await createMut.mutateAsync({
        name:     `${t.name} (copie)`,
        category: t.category,
        subject:  t.subject,
        body:     t.body,
        smsBody:  t.smsBody ?? undefined,
      })
      toast.success(`Modèle « ${t.name} » dupliqué`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Modèles de messages</h2>
          <p className="text-sm text-muted-foreground">Rédigez des templates réutilisables avec variables dynamiques.</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="mr-1.5 size-4" /> Nouveau modèle
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0,1,2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <FileTextIcon className="size-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">Aucun modèle</p>
            <p className="text-xs text-muted-foreground">Créez un premier template pour l'utiliser dans vos règles.</p>
          </div>
          <Button size="sm" variant="outline" onClick={openCreate}>
            <PlusIcon className="mr-1.5 size-3.5" /> Créer un modèle
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-xl border overflow-hidden">
          {templates.map(t => (
            <div key={t.id} className="flex items-start justify-between gap-4 px-4 py-3 bg-card hover:bg-muted/30 transition-colors">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">{t.name}</p>
                  <span className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                    t.active
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-muted text-muted-foreground",
                  )}>
                    {t.active ? "Actif" : "Inactif"}
                  </span>
                  <span className="text-[10px] text-muted-foreground border rounded-full px-2 py-0.5">
                    {TEMPLATE_CATEGORY_LABELS[t.category]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
                <p className="text-[11px] text-muted-foreground/60">
                  {t._count.rules} règle{t._count.rules !== 1 ? "s" : ""} · modifié le {format(new Date(t.updatedAt), "d MMM yyyy", { locale: fr })}
                </p>
              </div>
              <div className="shrink-0">
                <RowActions actions={[
                  { label: "Modifier",  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => openEdit(t) },
                  { label: "Dupliquer", icon: <CopyIcon className="size-3.5" />, onClick: () => handleDuplicate(t), disabled: createMut.isPending },
                  {
                    label:   t.active ? "Désactiver" : "Activer",
                    icon:    t.active ? <PauseCircleIcon className="size-3.5" /> : <PlayCircleIcon className="size-3.5" />,
                    onClick: () => handleToggle(t),
                    disabled: toggleMut.isPending,
                  },
                  { label: "Supprimer", icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(t) },
                ]} />
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        template={editTarget}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title={`Supprimer « ${deleteTarget?.name} » ?`}
        description={
          deleteTarget?._count.rules
            ? `Ce modèle est utilisé par ${deleteTarget._count.rules} règle${deleteTarget._count.rules > 1 ? "s" : ""}. Supprimez-les d'abord.`
            : "Ce modèle sera supprimé définitivement."
        }
        confirmLabel="Supprimer"
        confirmDisabled={!!deleteTarget?._count.rules}
        loading={deleteMut.isPending}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={open => !open && setDeactivateTarget(null)}
        title={`Désactiver « ${deactivateTarget?.name} » ?`}
        description={`${deactivateTarget?.activeRulesCount} règle${(deactivateTarget?.activeRulesCount ?? 0) > 1 ? "s" : ""} active${(deactivateTarget?.activeRulesCount ?? 0) > 1 ? "s" : ""} ${(deactivateTarget?.activeRulesCount ?? 0) > 1 ? "utilisent" : "utilise"} ce modèle et n'enverr${(deactivateTarget?.activeRulesCount ?? 0) > 1 ? "ont" : "a"} plus rien tant qu'il reste désactivé.`}
        confirmLabel="Désactiver"
        loading={toggleMut.isPending}
        onConfirm={handleConfirmDeactivate}
      />
    </div>
  )
}
