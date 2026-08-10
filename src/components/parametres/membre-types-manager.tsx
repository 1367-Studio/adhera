"use client"

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useMembreTypes, useCreateMembreType, useUpdateMembreType, useDeleteMembreType,
  type MembreType,
} from "@/hooks/use-membre-types"
import { membreTypeSchema, type MembreTypeInput, MEMBRE_TYPE_COLORS, NAME_MAX, DESCRIPTION_MAX } from "@/lib/schemas"
import { MembreTypeBadge, getTypeColor } from "@/components/ui/membre-type-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { cn } from "@/lib/utils"

function TypeForm({
  defaultValues,
  onSubmit,
  onCancel,
  loading,
}: {
  defaultValues?: Partial<MembreTypeInput>
  onSubmit: (data: MembreTypeInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}) {
  const t = useTranslations("parametres.membreTypes")
  const tCommon = useTranslations("common")
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<MembreTypeInput>({
    resolver:      zodResolver(membreTypeSchema),
    defaultValues: { color: "gray", ...defaultValues },
  })

  const selectedColor = watch("color")
  const nameValue     = watch("name") ?? ""
  const descValue     = watch("description") ?? ""

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
      <div>
        <FormField
          label={t("name")}
          required
          placeholder={t("namePlaceholder")}
          maxLength={NAME_MAX}
          error={errors.name?.message}
          {...register("name")}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">{nameValue.length}/{NAME_MAX}</p>
      </div>
      <div>
        <FormField
          label={t("description")}
          placeholder={t("descriptionPlaceholder")}
          maxLength={DESCRIPTION_MAX}
          error={errors.description?.message}
          {...register("description")}
        />
        {descValue.length > 0 && (
          <p className="mt-1 text-right text-xs text-muted-foreground">{descValue.length}/{DESCRIPTION_MAX}</p>
        )}
      </div>

      {/* Color picker */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">{t("color")}</label>
        <div className="flex flex-wrap gap-2">
          {MEMBRE_TYPE_COLORS.map(color => {
            const { dot } = getTypeColor(color)
            return (
              <button
                key={color}
                type="button"
                onClick={() => setValue("color", color)}
                className={cn(
                  "size-7 rounded-full border-2 transition-colors flex items-center justify-center",
                  selectedColor === color ? "border-foreground" : "border-transparent hover:border-muted-foreground/40",
                )}
              >
                <span className={cn("size-4 rounded-full", dot)} />
              </button>
            )
          })}
        </div>
        {selectedColor && (
          <MembreTypeBadge name={watch("name") || t("preview")} color={selectedColor} />
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={loading}>
          {tCommon("cancel")}
        </Button>
        <Button type="submit" size="sm" loading={loading}>
          {tCommon("save")}
        </Button>
      </div>
    </form>
  )
}

export function MembreTypesManager({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("parametres.membreTypes")
  const tCommon = useTranslations("common")
  const { data: types = [], isLoading } = useMembreTypes()
  const createMutation  = useCreateMembreType()
  const deleteMutation  = useDeleteMembreType()

  const [creating, setCreating]         = useState(false)
  const [editTarget, setEditTarget]     = useState<MembreType | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MembreType | null>(null)

  async function handleCreate(data: MembreTypeInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("toasts.created", { name: data.name }))
      setCreating(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("toasts.deleted", { name: deleteTarget.name }))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        {canEdit && !creating && !editTarget && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon className="size-3.5 mr-1" /> {t("add")}
          </Button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="rounded-lg border bg-muted/20 p-4">
          <TypeForm
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
            loading={createMutation.isPending}
          />
        </div>
      )}

      {/* ListIcon */}
      {isLoading ? (
        <div className="space-y-2">
          {[0,1,2].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : types.length === 0 && !creating ? (
        <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
          {t("noTypes")}
        </p>
      ) : (
        <ul className="space-y-2">
          {types.map(type => (
            <li key={type.id}>
              {editTarget?.id === type.id ? (
                <div className="rounded-lg border bg-muted/20 p-4">
                  <EditTypeForm
                    type={type}
                    onDone={() => setEditTarget(null)}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <MembreTypeBadge name={type.name} color={type.color} />
                    {type.description && (
                      <span className="text-xs text-muted-foreground truncate">{type.description}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{t("membersCount", { count: type._count.membres })}</span>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditTarget(type)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <PencilSimpleIcon className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(type)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <TrashIcon className="size-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title={t("deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={
          deleteTarget?._count.membres
            ? t("deleteConfirmInUse", { count: deleteTarget._count.membres })
            : t("deleteConfirmSimple")
        }
        confirmLabel={tCommon("delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function EditTypeForm({ type, onDone }: { type: MembreType; onDone: () => void }) {
  const t = useTranslations("parametres.membreTypes")
  const tCommon = useTranslations("common")
  const updateMutation = useUpdateMembreType(type.id)

  async function handleUpdate(data: MembreTypeInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("toasts.updated"))
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  return (
    <TypeForm
      defaultValues={{ name: type.name, description: type.description ?? "", color: type.color as MembreTypeInput["color"] }}
      onSubmit={handleUpdate}
      onCancel={onDone}
      loading={updateMutation.isPending}
    />
  )
}
