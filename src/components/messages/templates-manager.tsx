"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, PencilIcon, Trash2Icon, FileTextIcon } from "lucide-react"
import { useMessageTemplates, useDeleteTemplate, type MessageTemplate } from "@/hooks/use-message-templates"
import { TemplateModal } from "@/components/messages/template-modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"

export function TemplatesManager() {
  const { data: templates = [], isLoading } = useMessageTemplates()
  const deleteMut = useDeleteTemplate()

  const [modalOpen,    setModalOpen]    = useState(false)
  const [editTarget,   setEditTarget]   = useState<MessageTemplate | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null)

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
                <p className="font-medium text-sm truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
                <p className="text-[11px] text-muted-foreground/60">
                  {t._count.rules} règle{t._count.rules !== 1 ? "s" : ""} · modifié le {format(new Date(t.updatedAt), "d MMM yyyy", { locale: fr })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Modifier"
                >
                  <PencilIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(t)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title="Supprimer"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
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
    </div>
  )
}
