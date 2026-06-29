"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import { PlusIcon, ClipboardListIcon, UsersIcon, CheckCircleIcon, LockIcon, FileEditIcon, SearchIcon } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Pagination } from "@/components/ui/pagination"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { PaginatedResult } from "@/lib/pagination"

type Sondage = {
  id:           string
  title:        string
  description:  string | null
  status:       "BROUILLON" | "ACTIF" | "FERME"
  recipientMode: string
  anonymous:    boolean
  deadline:     string | null
  createdAt:    string
  _count:       { reponses: number; questions: number }
}

const STATUS_LABEL = { BROUILLON: "Brouillon", ACTIF: "Actif", FERME: "Fermé" }
const STATUS_VARIANT: Record<string, "secondary" | "default" | "outline"> = {
  BROUILLON: "secondary",
  ACTIF:     "default",
  FERME:     "outline",
}
const STATUS_ICON = {
  BROUILLON: <FileEditIcon className="size-3" />,
  ACTIF:     <CheckCircleIcon className="size-3" />,
  FERME:     <LockIcon className="size-3" />,
}

const PAGE_SIZE = 20

export default function SondagesPage() {
  const router = useRouter()
  const qc     = useQueryClient()
  const [deleteTarget,  setDeleteTarget]  = useState<Sondage | null>(null)
  const [page,          setPage]          = useState(1)
  const [searchInput,   setSearchInput]   = useState("")
  const [search,        setSearch]        = useState("")

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data: result, isLoading } = useQuery<PaginatedResult<Sondage>>({
    queryKey:  ["sondages", page, search],
    queryFn:   () => {
      const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (search) p.set("search", search)
      return fetch(`/api/sondages?${p}`).then(r => r.json())
    },
    staleTime: 0,
  })

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const sondages = result?.data ?? []

  const activateMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/sondages/${id}/activate`, { method: "POST" }).then(r => {
      if (!r.ok) return r.json().then(d => Promise.reject(new Error(d.error)))
      return r.json()
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sondages"] }); setPage(1); toast.success("Sondage activé") },
    onError:   (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  const closeMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/sondages/${id}/close`, { method: "POST" }).then(r => {
      if (!r.ok) return r.json().then(d => Promise.reject(new Error(d.error)))
      return r.json()
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sondages"] }); setPage(1); toast.success("Sondage fermé") },
    onError:   (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/sondages/${id}`, { method: "DELETE" }).then(r => {
      if (!r.ok) return r.json().then(d => Promise.reject(new Error(d.error)))
      return r.json()
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sondages"] }); setPage(1); toast.success("Sondage supprimé"); setDeleteTarget(null) },
    onError:   (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sondages"
        description="Créez des questionnaires et consultez les résultats."
        action={
          <Button size="sm" onClick={() => router.push("/dashboard/sondages/nouveau")}>
            <PlusIcon className="mr-1.5 size-4" />
            Nouveau sondage
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Rechercher…"
          className="pl-8 h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl border p-4 animate-pulse space-y-2">
              <div className="h-5 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : sondages.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-3">
          <ClipboardListIcon className="size-10 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">Aucun sondage. Créez votre premier questionnaire.</p>
          <Button size="sm" onClick={() => router.push("/dashboard/sondages/nouveau")}>
            <PlusIcon className="mr-1.5 size-4" />
            Nouveau sondage
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {sondages.map(s => (
            <div
              key={s.id}
              onClick={() => router.push(`/dashboard/sondages/${s.id}`)}
              className="rounded-xl border bg-card p-4 flex items-center gap-4 cursor-pointer hover:border-ring transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm truncate">{s.title}</span>
                  <Badge variant={STATUS_VARIANT[s.status]} className="gap-1 shrink-0">
                    {STATUS_ICON[s.status]}
                    {STATUS_LABEL[s.status]}
                  </Badge>
                  {s.anonymous && (
                    <Badge variant="outline" className="text-xs shrink-0">Anonyme</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span>{s._count.questions} question{s._count.questions !== 1 ? "s" : ""}</span>
                  <span className="flex items-center gap-1">
                    <UsersIcon className="size-3" />
                    {s._count.reponses} réponse{s._count.reponses !== 1 ? "s" : ""}
                  </span>
                  {s.deadline && (
                    <span>
                      Clôture : {format(new Date(s.deadline), "d MMM yyyy", { locale: fr })}
                    </span>
                  )}
                  <span className={cn(
                    s.recipientMode === "ALL" ? "text-muted-foreground" : "text-violet-600 dark:text-violet-400",
                  )}>
                    {s.recipientMode === "ALL" ? "Tous les membres" : "Sélection"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                {s.status === "BROUILLON" && (
                  <Button
                    size="sm"
                    onClick={() => activateMutation.mutate(s.id)}
                    loading={activateMutation.isPending}
                    className="h-7 text-xs"
                  >
                    Activer
                  </Button>
                )}
                {s.status === "ACTIF" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => closeMutation.mutate(s.id)}
                    loading={closeMutation.isPending}
                    className="h-7 text-xs"
                  >
                    Fermer
                  </Button>
                )}
                <RowActions actions={[
                  { label: "Modifier", onClick: () => router.push(`/dashboard/sondages/${s.id}`) },
                  ...(s.status === "BROUILLON" ? [{
                    label: "Supprimer",
                    destructive: true as const,
                    separator: true as const,
                    onClick: () => setDeleteTarget(s),
                  }] : []),
                ]} />
              </div>
            </div>
          ))}
        </div>
      )}

      {result && result.totalPages > 1 && (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          limit={result.limit}
          onPageChange={setPage}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null) }}
        title="Supprimer ce sondage ?"
        description={deleteTarget?.title ?? ""}
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id) }}
      />
    </div>
  )
}
