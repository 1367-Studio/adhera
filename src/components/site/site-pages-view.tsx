"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  PlusIcon, PencilSimpleIcon, PaperPlaneTiltIcon, EyeSlashIcon, TrashIcon,
  CaretUpIcon, CaretDownIcon, ArrowLeftIcon, ListIcon,
} from "@phosphor-icons/react/dist/ssr"
import { apiError } from "@/lib/api-error"
import { PageHeader } from "@/components/ui/page-header"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { FormField } from "@/components/ui/form-field"
import { DataTable, type Column } from "@/components/ui/data-table"
import { SiteNavMenusModal } from "@/components/site/site-nav-menus-modal"
import {
  useSitePages, useCreateSitePage, usePublishSitePage, useUnpublishSitePage, useDeleteSitePage,
  type SitePageListItem, type SitePageDetail,
} from "@/hooks/use-site-pages"
import { useSiteNavMenus } from "@/hooks/use-site-nav-menus"

// FORM-7 "Pages": custom pages beyond the single home page (src/components/site/puck/
// site-puck-editor.tsx). Reachable from that editor's toolbar ("Pages" button) and from here
// back into each page's own editor (src/components/site/puck/site-page-editor.tsx).

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function PublishedToggleActions({ sitePage }: { sitePage: SitePageListItem }) {
  const publishSitePage   = usePublishSitePage(sitePage.id)
  const unpublishSitePage = useUnpublishSitePage(sitePage.id)
  const [publishing, setPublishing] = useState(false)

  // The list only loads the summary (no draftContent) — publishing needs the full page's
  // current draft, so it's fetched on demand rather than carried on every row all the time.
  async function handlePublish() {
    setPublishing(true)
    try {
      const response = await fetch(`/api/site-pages/${sitePage.id}`)
      if (!response.ok) throw await apiError(response, "Erreur lors du chargement de la page")
      const { sitePage: detail } = await response.json() as { sitePage: SitePageDetail }
      await publishSitePage.mutateAsync({ content: detail.draftContent.content, zones: detail.draftContent.zones ?? {} })
      toast.success("Page publiée")
    } catch (publishError) {
      toast.error(publishError instanceof Error ? publishError.message : "Erreur lors de la publication")
    } finally {
      setPublishing(false)
    }
  }

  async function handleUnpublish() {
    try {
      await unpublishSitePage.mutateAsync()
      toast.success("Page dépubliée")
    } catch (unpublishError) {
      toast.error(unpublishError instanceof Error ? unpublishError.message : "Erreur lors de la dépublication")
    }
  }

  return sitePage.status === "PUBLISHED" ? (
    <Button
      variant="ghost" size="icon-sm" aria-label="Dépublier"
      onClick={event => { event.stopPropagation(); handleUnpublish() }}
    >
      <EyeSlashIcon className="size-4" />
    </Button>
  ) : (
    <Button
      variant="ghost" size="icon-sm" disabled={publishing} aria-label="Publier"
      onClick={event => { event.stopPropagation(); void handlePublish() }}
    >
      <PaperPlaneTiltIcon className="size-4" />
    </Button>
  )
}

export function SitePagesView() {
  const router = useRouter()
  const sitePagesQuery = useSitePages()
  const siteNavMenusQuery = useSiteNavMenus()
  const createSitePage = useCreateSitePage()
  const deleteSitePage = useDeleteSitePage()

  const associationQuery = useQuery<{ slug: string }>({
    queryKey: ["association"],
    queryFn:  () => fetch("/api/association").then(response => response.json()),
  })

  const [createOpen, setCreateOpen]   = useState(false)
  const [menusOpen, setMenusOpen]     = useState(false)
  const [title, setTitle]             = useState("")
  const [slug, setSlug]               = useState("")
  const [slugEdited, setSlugEdited]   = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SitePageListItem | null>(null)

  function handleTitleChange(value: string) {
    setTitle(value)
    if (!slugEdited) setSlug(slugify(value))
  }

  async function handleCreate() {
    try {
      const { sitePage } = await createSitePage.mutateAsync({ title: title.trim(), slug })
      setCreateOpen(false)
      setTitle("")
      setSlug("")
      setSlugEdited(false)
      router.push(`/dashboard/site/pages/${sitePage.id}`)
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "Erreur lors de la création de la page")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteSitePage.mutateAsync(deleteTarget.id)
    toast.success("Page supprimée")
    setDeleteTarget(null)
  }

  const sitePages = sitePagesQuery.data ?? []
  const navPages   = sitePages.filter(page => page.showInNav).sort((a, b) => a.navPosition - b.navPosition)

  // Swaps navPosition between two rows — not routed through useSaveSitePage (that hook is
  // scoped to one id picked at render time, not a pair picked on click), so this calls the
  // same PUT endpoint directly and refetches the list it already has loaded.
  async function putNavPosition(id: string, navPosition: number) {
    const response = await fetch(`/api/site-pages/${id}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ navPosition }),
    })
    if (!response.ok) throw await apiError(response, "Erreur lors de l'enregistrement")
  }

  async function moveNavPosition(sitePage: SitePageListItem, direction: "up" | "down") {
    const index = navPages.findIndex(page => page.id === sitePage.id)
    const otherIndex = direction === "up" ? index - 1 : index + 1
    const other = navPages[otherIndex]
    if (!other) return
    try {
      await Promise.all([
        putNavPosition(sitePage.id, other.navPosition),
        putNavPosition(other.id, sitePage.navPosition),
      ])
      await sitePagesQuery.refetch()
    } catch (moveError) {
      toast.error(moveError instanceof Error ? moveError.message : "Erreur lors de l'enregistrement")
    }
  }

  const columns: Column<SitePageListItem>[] = [
    {
      key:    "title",
      header: "Titre",
      cell:   row => <span className="font-medium">{row.title}</span>,
    },
    {
      key:    "url",
      header: "URL",
      cell:   row => (
        <span className="text-sm text-muted-foreground">
          /{associationQuery.data?.slug ?? "…"}/{row.slug}
        </span>
      ),
    },
    {
      key:    "status",
      header: "Statut",
      cell:   row => (
        row.status === "PUBLISHED"
          ? <Badge variant="success">Publié</Badge>
          : <Badge variant="secondary">Brouillon</Badge>
      ),
    },
    {
      key:        "nav",
      header:     "Dans le menu",
      hideInCard: true,
      cell:       row => {
        if (!row.showInNav) return <span className="text-sm text-muted-foreground">—</span>
        const index = navPages.findIndex(page => page.id === row.id)
        const menuLabel = row.navMenuId
          ? siteNavMenusQuery.data?.find(menu => menu.id === row.navMenuId)?.label
          : null
        return (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span>{row.navLabel || row.title}{menuLabel && ` · ${menuLabel}`}</span>
            <Button
              variant="ghost" size="icon-sm" className="size-6"
              disabled={index <= 0}
              onClick={() => void moveNavPosition(row, "up")}
              aria-label="Monter dans le menu"
            >
              <CaretUpIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon-sm" className="size-6"
              disabled={index < 0 || index >= navPages.length - 1}
              onClick={() => void moveNavPosition(row, "down")}
              aria-label="Descendre dans le menu"
            >
              <CaretDownIcon className="size-3.5" />
            </Button>
          </div>
        )
      },
    },
    {
      key:        "updatedAt",
      header:     "Mis à jour",
      hideInCard: true,
      cell:       row => (
        <span className="text-sm text-muted-foreground">
          {format(new Date(row.updatedAt), "d MMM yyyy", { locale: fr })}
        </span>
      ),
    },
    {
      key:    "actions",
      header: "",
      cell:   row => (
        <div className="flex items-center justify-end gap-1">
          <PublishedToggleActions sitePage={row} />
          <RowActions
            actions={[
              { label: "Éditer", icon: <PencilSimpleIcon className="size-4" />, onClick: () => router.push(`/dashboard/site/pages/${row.id}`) },
              {
                label:       "Supprimer",
                icon:        <TrashIcon className="size-4" />,
                destructive: true,
                separator:   true,
                onClick:     () => setDeleteTarget(row),
              },
            ]}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="px-4 py-2 sm:px-6">
      <Button
        variant="ghost" size="sm" className="-ml-2 mt-2 text-muted-foreground"
        onClick={() => router.push("/dashboard/site/puck")}
      >
        <ArrowLeftIcon className="size-3.5" />
        Site web
      </Button>
      <PageHeader
        title="Pages"
        description="Pages supplémentaires du site de l'association, au-delà de la page d'accueil."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setMenusOpen(true)}>
              <ListIcon className="size-4" />
              Menus déroulants
            </Button>
            <Button onClick={() => setCreateOpen(true)}><PlusIcon className="size-4" />Nouvelle page</Button>
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={sitePages}
        loading={sitePagesQuery.isLoading}
        keyExtractor={row => row.id}
        onRowClick={row => router.push(`/dashboard/site/pages/${row.id}`)}
        empty="Aucune page pour l'instant"
      />

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Nouvelle page"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button onClick={() => void handleCreate()} disabled={!title.trim() || !slug.trim() || createSitePage.isPending}>
              Créer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField
            label="Titre"
            value={title}
            onChange={event => handleTitleChange(event.target.value)}
            autoFocus
          />
          <FormField
            label="Adresse"
            value={slug}
            onChange={event => { setSlug(slugify(event.target.value)); setSlugEdited(true) }}
            hint={associationQuery.data ? `/${associationQuery.data.slug}/${slug || "…"}` : undefined}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title="Supprimer cette page ?"
        description="Cette action est définitive. La page ne sera plus accessible aux visiteurs."
        confirmLabel="Supprimer"
        loading={deleteSitePage.isPending}
        onConfirm={handleDelete}
      />

      <SiteNavMenusModal open={menusOpen} onOpenChange={setMenusOpen} sitePages={sitePages} />
    </div>
  )
}
