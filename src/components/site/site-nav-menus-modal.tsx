"use client"

import { useState } from "react"
import { toast } from "sonner"
import { PlusIcon, TrashIcon, CaretUpIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  useSiteNavMenus, useCreateSiteNavMenu, useSaveSiteNavMenu, useDeleteSiteNavMenu, type SiteNavMenuItem,
} from "@/hooks/use-site-nav-menus"
import type { SitePageListItem } from "@/hooks/use-site-pages"
import { MAX_SITE_NAV_MENUS } from "@/lib/site-puck/site-nav-menu"

// Manages the association's named dropdown menus (SiteNavMenu) for the public site's header —
// create, rename, reorder and delete, independent of any one page. Each page then picks one of
// these (or none, for its own header button) from its own nav settings — see
// site-page-editor.tsx's SitePageNavPopover.

type SiteNavMenusModalProps = {
  open:         boolean
  onOpenChange: (open: boolean) => void
  // To show each menu's page count and name a delete's impact precisely — the caller already
  // has the pages list loaded (site-pages-view.tsx), so this avoids a second fetch of the same
  // data just to count by navMenuId.
  sitePages:    SitePageListItem[]
}

export function SiteNavMenusModal({ open, onOpenChange, sitePages }: SiteNavMenusModalProps) {
  const siteNavMenusQuery = useSiteNavMenus()
  const createSiteNavMenu = useCreateSiteNavMenu()
  const saveSiteNavMenu   = useSaveSiteNavMenu()
  const deleteSiteNavMenu = useDeleteSiteNavMenu()

  const [newLabel, setNewLabel]         = useState("")
  const [deleteTarget, setDeleteTarget] = useState<SiteNavMenuItem | null>(null)

  const siteNavMenus = (siteNavMenusQuery.data ?? []).slice().sort((a, b) => a.position - b.position)
  const pageCountByMenuId = new Map<string, number>()
  for (const sitePage of sitePages) {
    if (!sitePage.navMenuId) continue
    pageCountByMenuId.set(sitePage.navMenuId, (pageCountByMenuId.get(sitePage.navMenuId) ?? 0) + 1)
  }

  // Any mutation in flight disables every reorder/rename-adjacent control below — these swap or
  // shift `position` pairwise, and firing a second one (a mashed Enter, a fast double-click)
  // before the first's optimistic cache update lands would read stale positions and corrupt the
  // order instead of just queueing harmlessly.
  const mutationPending = createSiteNavMenu.isPending || saveSiteNavMenu.isPending
  const atCap = siteNavMenus.length >= MAX_SITE_NAV_MENUS

  async function handleCreate() {
    if (mutationPending || atCap) return
    const label = newLabel.trim()
    if (!label) return
    try {
      await createSiteNavMenu.mutateAsync({ label })
      setNewLabel("")
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "Erreur lors de la création du menu")
    }
  }

  async function handleRename(menu: SiteNavMenuItem, label: string) {
    const trimmedLabel = label.trim()
    if (!trimmedLabel || trimmedLabel === menu.label) return
    try {
      await saveSiteNavMenu.mutateAsync({ id: menu.id, label: trimmedLabel })
    } catch (renameError) {
      toast.error(renameError instanceof Error ? renameError.message : "Erreur lors de l'enregistrement")
    }
  }

  async function handleMove(menu: SiteNavMenuItem, direction: "up" | "down") {
    if (mutationPending) return
    const index = siteNavMenus.findIndex(item => item.id === menu.id)
    const other = siteNavMenus[direction === "up" ? index - 1 : index + 1]
    if (!other) return
    try {
      await Promise.all([
        saveSiteNavMenu.mutateAsync({ id: menu.id, position: other.position }),
        saveSiteNavMenu.mutateAsync({ id: other.id, position: menu.position }),
      ])
    } catch (moveError) {
      toast.error(moveError instanceof Error ? moveError.message : "Erreur lors de l'enregistrement")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteSiteNavMenu.mutateAsync(deleteTarget.id)
    toast.success("Menu supprimé")
    setDeleteTarget(null)
  }

  const deleteTargetPageCount = deleteTarget ? pageCountByMenuId.get(deleteTarget.id) ?? 0 : 0

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title="Menus déroulants">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Groupez plusieurs pages sous un même menu déroulant de l&rsquo;en-tête. Chaque page choisit son menu depuis ses propres réglages.
          </p>

          {siteNavMenus.length === 0 && !siteNavMenusQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Aucun menu pour l&rsquo;instant.</p>
          )}

          {siteNavMenus.length > 0 && (
            <div className="space-y-1.5">
              {siteNavMenus.map((menu, index) => {
                const pageCount = pageCountByMenuId.get(menu.id) ?? 0
                return (
                  <div key={menu.id} className="flex items-center gap-2">
                    <div className="flex-1 space-y-0.5">
                      <Input
                        // Keyed by the server's own label too: a rename made elsewhere (another
                        // tab, another admin) must remount this uncontrolled input with the
                        // fresh value on refetch — otherwise it would keep showing whatever was
                        // last typed here, now stale.
                        key={menu.label}
                        defaultValue={menu.label}
                        aria-label="Nom du menu"
                        disabled={mutationPending}
                        onBlur={event => void handleRename(menu, event.target.value)}
                        className="h-9"
                      />
                      <p className="px-1 text-xs text-muted-foreground">
                        {pageCount === 0 ? "Aucune page — invisible sur le site" : `${pageCount} page${pageCount > 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost" size="icon-sm" className="size-8" disabled={index === 0 || mutationPending}
                      onClick={() => void handleMove(menu, "up")} aria-label="Monter"
                    >
                      <CaretUpIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon-sm" className="size-8" disabled={index === siteNavMenus.length - 1 || mutationPending}
                      onClick={() => void handleMove(menu, "down")} aria-label="Descendre"
                    >
                      <CaretDownIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon-sm" className="size-8 text-destructive hover:text-destructive"
                      disabled={mutationPending}
                      onClick={() => setDeleteTarget(menu)} aria-label="Supprimer"
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="space-y-1.5 border-t pt-3">
            <div className="flex items-center gap-1">
              <Input
                placeholder="Nouveau menu"
                aria-label="Nom du nouveau menu"
                value={newLabel}
                disabled={mutationPending || atCap}
                onChange={event => setNewLabel(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter") void handleCreate() }}
                className="h-9"
              />
              <Button
                variant="outline" size="icon-sm" className="size-9"
                disabled={!newLabel.trim() || mutationPending || atCap}
                onClick={() => void handleCreate()} aria-label="Ajouter un menu"
              >
                <PlusIcon className="size-4" />
              </Button>
            </div>
            {atCap && (
              <p className="text-xs text-muted-foreground">
                Limite de {MAX_SITE_NAV_MENUS} menus atteinte — supprimez-en un pour en créer un autre.
              </p>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={openValue => { if (!openValue) setDeleteTarget(null) }}
        title="Supprimer ce menu ?"
        description={
          deleteTargetPageCount > 0
            ? `${deleteTargetPageCount} page${deleteTargetPageCount > 1 ? "s" : ""} retrouvera${deleteTargetPageCount > 1 ? "ont" : ""} son propre bouton dans l'en-tête.`
            : "Ce menu ne contient aucune page."
        }
        confirmLabel="Supprimer"
        loading={deleteSiteNavMenu.isPending}
        onConfirm={handleDelete}
      />
    </>
  )
}
