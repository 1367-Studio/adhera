"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { PencilSimpleIcon, TrashIcon, CheckIcon, XIcon } from "@phosphor-icons/react/dist/ssr"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  useTacheCategories,
  useRenameTacheCategorie,
  useArchiveTacheCategorie,
  type TacheCategorie,
} from "@/hooks/use-taches"

export function GererCategoriesPopover() {
  const t = useTranslations("taches.form.manageCategories")
  const tCommon = useTranslations("common")
  const { data: categories = [] } = useTacheCategories()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [archiving, setArchiving] = useState<TacheCategorie | null>(null)

  // Appelé inconditionnellement (règle des hooks) : la mutation ne fait quelque chose que
  // lorsqu'on l'invoque, donc un id vide tant qu'aucune ligne n'est en édition est sans effet.
  const renameCategorie = useRenameTacheCategorie(editingId ?? "")
  const archiveCategorie = useArchiveTacheCategorie()

  function startEdit(categorie: TacheCategorie) {
    setEditingId(categorie.id)
    setEditingName(categorie.nom)
  }

  async function handleRename() {
    if (!editingId || !editingName.trim()) return
    try {
      await renameCategorie.mutateAsync({ nom: editingName.trim() })
      toast.success(t("toasts.renamed"))
      setEditingId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  async function handleArchive() {
    if (!archiving) return
    try {
      await archiveCategorie.mutateAsync(archiving.id)
      toast.success(t("toasts.archived"))
      setArchiving(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          {t("trigger")}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <p className="px-1 text-sm font-medium">{t("title")}</p>
          <div className="flex flex-col gap-0.5">
            {categories.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">{t("empty")}</p>
            )}
            {categories.map(categorie => (
              <div key={categorie.id} className="flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-muted/50">
                {editingId === categorie.id ? (
                  <>
                    <Input
                      autoFocus
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleRename()
                        if (e.key === "Escape") setEditingId(null)
                      }}
                      className="h-8 flex-1"
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={handleRename}
                      loading={renameCategorie.isPending}
                      aria-label={tCommon("save")}
                    >
                      <CheckIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      aria-label={tCommon("cancel")}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate text-sm">{categorie.nom}</span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => startEdit(categorie)}
                      aria-label={tCommon("edit")}
                    >
                      <PencilSimpleIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setArchiving(categorie)}
                      aria-label={tCommon("delete")}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={v => { if (!v) setArchiving(null) }}
        title={t("archiveConfirmTitle")}
        description={t("archiveConfirmDescription")}
        confirmLabel={tCommon("delete")}
        loading={archiveCategorie.isPending}
        onConfirm={handleArchive}
      />
    </>
  )
}
