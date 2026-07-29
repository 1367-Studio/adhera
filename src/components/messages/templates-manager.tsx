"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useTranslations } from "next-intl"
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
import type { TemplateCategory } from "@/lib/automation"

function getTemplateCategoryLabels(t: ReturnType<typeof useTranslations>): Record<TemplateCategory, string> {
  return {
    GENERAL:     t("messages.categories.general"),
    COTISATION:  t("messages.categories.cotisation"),
    EVENEMENT:   t("messages.categories.evenement"),
    MEMBRE:      t("messages.categories.membre"),
    FACTURATION: t("messages.categories.facturation"),
  }
}

export function TemplatesManager() {
  const t = useTranslations()
  const templateCategoryLabels = getTemplateCategoryLabels(t)
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
      toast.success(t("messages.templatesManager.toasts.deleted", { name: deleteTarget.name }))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function doToggle(template: MessageTemplate) {
    try {
      await toggleMut.mutateAsync({ id: template.id, active: !template.active })
      toast.success(template.active ? t("messages.templatesManager.toasts.deactivated") : t("messages.templatesManager.toasts.activated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  function handleToggle(template: MessageTemplate) {
    // Deactivating silently stops every active rule that uses this template — confirm
    // when that's actually at stake. Reactivating has no downside, so it's immediate.
    if (template.active && template.activeRulesCount > 0) {
      setDeactivateTarget(template)
      return
    }
    doToggle(template)
  }

  async function handleConfirmDeactivate() {
    if (!deactivateTarget) return
    await doToggle(deactivateTarget)
    setDeactivateTarget(null)
  }

  async function handleDuplicate(template: MessageTemplate) {
    try {
      await createMut.mutateAsync({
        name:     `${template.name}${t("messages.templatesManager.toasts.duplicateSuffix")}`,
        category: template.category,
        subject:  template.subject,
        body:     template.body,
        smsBody:  template.smsBody ?? undefined,
      })
      toast.success(t("messages.templatesManager.toasts.duplicated", { name: template.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{t("messages.templatesManager.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("messages.templatesManager.subtitle")}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="mr-1.5 size-4" /> {t("messages.templatesManager.newTemplate")}
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
            <p className="text-sm font-medium">{t("messages.templatesManager.noTemplates")}</p>
            <p className="text-xs text-muted-foreground">{t("messages.templatesManager.noTemplatesHint")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={openCreate}>
            <PlusIcon className="mr-1.5 size-3.5" /> {t("messages.templatesManager.createTemplate")}
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-xl border overflow-hidden">
          {templates.map(template => (
            <div key={template.id} className="flex items-start justify-between gap-4 px-4 py-3 bg-card hover:bg-muted/30 transition-colors">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">{template.name}</p>
                  <span className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                    template.active
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-muted text-muted-foreground",
                  )}>
                    {template.active ? t("messages.templatesManager.active") : t("messages.templatesManager.inactive")}
                  </span>
                  <span className="text-[10px] text-muted-foreground border rounded-full px-2 py-0.5">
                    {templateCategoryLabels[template.category]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{template.subject}</p>
                <p className="text-[11px] text-muted-foreground/60">
                  {t("messages.templatesManager.rulesCount", { count: template._count.rules })}
                  {t("messages.templatesManager.modifiedOn", { date: format(new Date(template.updatedAt), "d MMM yyyy", { locale: fr }) })}
                </p>
              </div>
              <div className="shrink-0">
                <RowActions actions={[
                  { label: t("messages.templatesManager.actions.edit"),  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => openEdit(template) },
                  { label: t("messages.templatesManager.actions.duplicate"), icon: <CopyIcon className="size-3.5" />, onClick: () => handleDuplicate(template), disabled: createMut.isPending },
                  {
                    label:   template.active ? t("messages.templatesManager.actions.deactivate") : t("messages.templatesManager.actions.activate"),
                    icon:    template.active ? <PauseCircleIcon className="size-3.5" /> : <PlayCircleIcon className="size-3.5" />,
                    onClick: () => handleToggle(template),
                    disabled: toggleMut.isPending,
                  },
                  { label: t("messages.templatesManager.actions.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(template) },
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
        title={t("messages.templatesManager.deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={
          deleteTarget?._count.rules
            ? t("messages.templatesManager.deleteConfirmInUse", { count: deleteTarget._count.rules })
            : t("messages.templatesManager.deleteConfirmSimple")
        }
        confirmLabel={t("messages.templatesManager.actions.delete")}
        confirmDisabled={!!deleteTarget?._count.rules}
        loading={deleteMut.isPending}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={open => !open && setDeactivateTarget(null)}
        title={t("messages.templatesManager.deactivateConfirmTitle", { name: deactivateTarget?.name ?? "" })}
        description={t("messages.templatesManager.deactivateConfirmDescription", { count: deactivateTarget?.activeRulesCount ?? 0 })}
        confirmLabel={t("messages.templatesManager.actions.deactivate")}
        loading={toggleMut.isPending}
        onConfirm={handleConfirmDeactivate}
      />
    </div>
  )
}
