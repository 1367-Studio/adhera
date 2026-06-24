"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import {
  PlusIcon, PencilIcon, Trash2Icon, SearchIcon, XIcon,
  PinIcon, SendIcon, EyeOffIcon, CalendarIcon, ImageIcon,
  LayoutGridIcon, ListIcon,
} from "lucide-react"
import { ViewToggle } from "@/components/ui/view-toggle"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  useActualitesPaginated, useCreateActualite,
  useUpdateActualite, useDeleteActualite,
} from "@/hooks/use-actualites"
import type { ActualiteInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ActualiteForm } from "@/components/actualites/actualite-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { cn, stripHtml } from "@/lib/utils"

type EvenementRef = { id: string; title: string; date: string; location: string | null }

type Actualite = {
  id:            string
  title:         string
  content:       string
  imageUrl:      string | null
  pinned:        boolean
  publishedAt:   string | null
  evenementId:   string | null
  evenement:     EvenementRef | null
  recipientMode: string
  recipients:    { membreId: string }[]
  createdAt:     string
}

// Separate component so hooks run at component level, not inside a callback
function PostCard({
  post,
  onEdit,
  onDelete,
}: {
  post:     Actualite
  onEdit:   () => void
  onDelete: () => void
}) {
  const updateMutation = useUpdateActualite(post.id)
  const plainText = stripHtml(post.content)

  async function togglePublish() {
    try {
      const payload = post.publishedAt
        ? { publishedAt: null }
        : { publishedAt: new Date().toISOString() }
      await updateMutation.mutateAsync(payload)
      toast.success(
        post.publishedAt
          ? "Actualité dépubliée"
          : `« ${post.title} » publiée — membres notifiés`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const date = post.publishedAt
    ? format(new Date(post.publishedAt), "d MMM yyyy", { locale: fr })
    : format(new Date(post.createdAt), "d MMM yyyy", { locale: fr })

  return (
    <div className={cn(
      "group rounded-xl border bg-card overflow-hidden flex flex-col transition-all hover:shadow-md",
      !post.publishedAt && "border-dashed border-muted-foreground/40",
    )}>
      {/* Cover image */}
      <div className="relative aspect-video w-full overflow-hidden">
        {post.imageUrl ? (
          <>
            <img src={post.imageUrl} aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" />
            <img src={post.imageUrl} alt="" className="relative z-10 w-full h-full object-contain" />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
            <ImageIcon className="size-14 text-muted-foreground/20" />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-3.5 gap-2.5">
        {/* Badges + actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {post.publishedAt ? (
              <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[11px] font-medium px-2 py-0.5">
                Publié
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-[11px] font-medium px-2 py-0.5">
                Brouillon
              </span>
            )}
            {post.pinned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[11px] font-medium px-2 py-0.5">
                <PinIcon className="size-2.5" /> Épinglé
              </span>
            )}
          </div>
          <RowActions
            actions={[
              { label: "Modifier",  icon: <PencilIcon className="size-3.5" />, onClick: onEdit },
              post.publishedAt
                ? { label: "Dépublier", icon: <EyeOffIcon className="size-3.5" />, onClick: togglePublish, separator: true }
                : { label: "Publier",   icon: <SendIcon   className="size-3.5" />, onClick: togglePublish, separator: true },
              { label: "Supprimer", icon: <Trash2Icon className="size-3.5" />, destructive: true, separator: true, onClick: onDelete },
            ]}
          />
        </div>

        {/* Title + excerpt */}
        <div className="flex-1">
          <p className="font-semibold text-sm leading-snug line-clamp-2">{post.title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mt-1">{plainText}</p>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
          <span>{date}</span>
          {post.evenement && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 min-w-0">
                <CalendarIcon className="size-3 shrink-0" />
                <span className="truncate">{post.evenement.title}</span>
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PostRow({
  post,
  onEdit,
  onDelete,
}: {
  post:     Actualite
  onEdit:   () => void
  onDelete: () => void
}) {
  const updateMutation = useUpdateActualite(post.id)

  async function togglePublish() {
    try {
      const payload = post.publishedAt
        ? { publishedAt: null }
        : { publishedAt: new Date().toISOString() }
      await updateMutation.mutateAsync(payload)
      toast.success(post.publishedAt ? "Actualité dépubliée" : `« ${post.title} » publiée — membres notifiés`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const date = post.publishedAt
    ? format(new Date(post.publishedAt), "d MMM yyyy", { locale: fr })
    : format(new Date(post.createdAt),   "d MMM yyyy", { locale: fr })

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-1.5 shrink-0">
        {post.publishedAt ? (
          <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[11px] font-medium px-2 py-0.5">Publié</span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-[11px] font-medium px-2 py-0.5">Brouillon</span>
        )}
        {post.pinned && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[11px] font-medium px-2 py-0.5">
            <PinIcon className="size-2.5" /> Épinglé
          </span>
        )}
      </div>

      <p className="flex-1 text-sm font-medium truncate">{post.title}</p>

      {post.evenement && (
        <span className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
          <CalendarIcon className="size-3" />
          <span className="truncate max-w-[120px]">{post.evenement.title}</span>
        </span>
      )}

      <span className="text-[11px] text-muted-foreground shrink-0">{date}</span>

      <RowActions
        actions={[
          { label: "Modifier",  icon: <PencilIcon className="size-3.5" />, onClick: onEdit },
          post.publishedAt
            ? { label: "Dépublier", icon: <EyeOffIcon className="size-3.5" />, onClick: togglePublish, separator: true }
            : { label: "Publier",   icon: <SendIcon   className="size-3.5" />, onClick: togglePublish, separator: true },
          { label: "Supprimer", icon: <Trash2Icon className="size-3.5" />, destructive: true, separator: true, onClick: onDelete },
        ]}
      />
    </div>
  )
}

const VIEW_OPTIONS = [
  { value: "grid" as const, label: "Grille", icon: <LayoutGridIcon className="size-3.5" /> },
  { value: "list" as const, label: "Liste",  icon: <ListIcon        className="size-3.5" /> },
]

const PAGE_SIZE = 20

export function ActualitesView() {
  const [view, setView]               = useState<"grid" | "list">("grid")
  const [page, setPage]               = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch]           = useState("")
  const [createOpen, setCreateOpen]   = useState(false)
  const [editTarget, setEditTarget]   = useState<Actualite | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Actualite | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const { data: result, isLoading } = useActualitesPaginated(page, PAGE_SIZE, search || undefined)
  const posts = (result?.data ?? []) as Actualite[]

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation = useCreateActualite()
  const updateMutation = useUpdateActualite(editTarget?.id ?? "")
  const deleteMutation = useDeleteActualite()

  async function handleCreate(data: ActualiteInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Actualité créée")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: ActualiteInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Actualité mise à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Actualité supprimée")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Actualités"
        description={`${result?.total ?? 0} publication${(result?.total ?? 0) !== 1 ? "s" : ""}`}
        action={
          <div className="flex items-center gap-2">
            <ViewToggle options={VIEW_OPTIONS} value={view} onChange={setView} />
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              Rédiger
            </Button>
          </div>
        }
      />

      {/* Search */}
      <div className="relative w-72">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Rechercher une actualité…"
          value={searchInput}
          onChange={e => handleSearch(e.target.value)}
          className="w-full rounded-md border border-input bg-background pl-9 pr-8 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => { if (debounceRef.current) clearTimeout(debounceRef.current); setSearchInput(""); setSearch(""); setPage(1) }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>

      {/* Posts */}
      {isLoading ? (
        view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="rounded-xl border bg-card overflow-hidden animate-pulse">
                <div className="aspect-video bg-muted w-full" />
                <div className="p-3.5 space-y-2.5">
                  <div className="h-5 w-16 rounded-full bg-muted" />
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-full rounded bg-muted" />
                    <div className="h-3 w-4/5 rounded bg-muted" />
                  </div>
                  <div className="h-3 w-1/4 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 animate-pulse">
                <div className="h-5 w-16 rounded-full bg-muted" />
                <div className="h-4 flex-1 rounded bg-muted" />
                <div className="h-3 w-20 rounded bg-muted" />
              </div>
            ))}
          </div>
        )
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/10 py-16 text-center">
          <p className="text-muted-foreground text-sm">
            {search ? `Aucun résultat pour « ${search} »` : "Aucune publication créée"}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              onEdit={() => setEditTarget(post)}
              onDelete={() => setDeleteTarget(post)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          {posts.map(post => (
            <PostRow
              key={post.id}
              post={post}
              onEdit={() => setEditTarget(post)}
              onDelete={() => setDeleteTarget(post)}
            />
          ))}
        </div>
      )}

      {/* Simple pagination */}
      {result && result.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Précédent
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {result.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= result.totalPages} onClick={() => setPage(p => p + 1)}>
            Suivant
          </Button>
        </div>
      )}

      {/* Create modal */}
      <Modal open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)} title="Rédiger une actualité" size="2xl" dismissable={false}>
        <ActualiteForm
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title="Modifier l'actualité"
        size="2xl"
        dismissable={false}
      >
        <ActualiteForm
          defaultValues={editTarget ? {
            title:         editTarget.title,
            content:       editTarget.content,
            imageUrl:      editTarget.imageUrl    ?? "",
            pinned:        editTarget.pinned,
            evenementId:   editTarget.evenementId ?? "",
            recipientMode: (editTarget.recipientMode ?? "ALL") as "ALL" | "SELECTED",
            recipientIds:  editTarget.recipients?.map(r => r.membreId) ?? [],
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      {/* Delete */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Supprimer « ${deleteTarget?.title} » ?`}
        description="Cette publication sera supprimée définitivement."
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
