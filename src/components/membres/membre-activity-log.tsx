"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { UserPlusIcon, PencilIcon, Trash2Icon, GlobeIcon, LoaderCircleIcon, AlertCircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type FieldDiff = { old: string | null; new: string | null }

type MembreLog = {
  id:        string
  action:    string
  actorName: string | null
  actorId:   string | null
  metadata:  { changes?: Record<string, FieldDiff> } | null
  createdAt: string
}

type PageResult = {
  data:       MembreLog[]
  total:      number
  page:       number
  totalPages: number
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "Prénom",
  lastName:  "Nom",
  email:     "Email",
  phone:     "Téléphone",
  address:   "Adresse",
  birthDate: "Date de naissance",
  status:    "Statut",
  typeId:    "Type",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIF:    "Actif",
  INACTIF:  "Inactif",
  PENDING:  "En attente",
  SUSPENDU: "Suspendu",
}

const ACTION_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  MEMBRE_CREATED:           { label: "Membre ajouté",          icon: <UserPlusIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  MEMBRE_UPDATED:           { label: "Informations modifiées", icon: <PencilIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
  PROFIL_UPDATED:           { label: "Profil modifié",         icon: <PencilIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
  MEMBRE_DELETED:           { label: "Membre archivé",         icon: <Trash2Icon   className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"               },
  MEMBRE_PORTAL_REGISTERED: { label: "Inscription portail",    icon: <GlobeIcon    className="size-3.5" />, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"   },
}

function formatFieldValue(field: string, value: string | null): string {
  if (value === null || value === "") return "—"
  if (field === "status") return STATUS_LABELS[value] ?? value
  return value
}

function ChangeDiff({ changes }: { changes: Record<string, FieldDiff> }) {
  const entries = Object.entries(changes)
  if (entries.length === 0) return null
  return (
    <div className="mt-1.5 space-y-0.5">
      {entries.map(([field, diff]) => (
        <p key={field} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{FIELD_LABELS[field] ?? field}</span>
          {" : "}
          <span className="line-through opacity-60">{formatFieldValue(field, diff.old)}</span>
          {" → "}
          <span>{formatFieldValue(field, diff.new)}</span>
        </p>
      ))}
    </div>
  )
}

export function MembreActivityLog({ membreId }: { membreId: string }) {
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PageResult>({
    queryKey:        ["membre-logs", membreId],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/membres/${membreId}/logs?page=${pageParam}&pageSize=20`)
      if (!res.ok) throw new Error()
      return res.json()
    },
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  })

  const logs  = data?.pages.flatMap(p => p.data) ?? []
  const total = data?.pages[0]?.total ?? 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin mr-2" />
        <span className="text-sm">Chargement…</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <AlertCircleIcon className="size-4 shrink-0" />
        Impossible de charger l'historique.
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Aucune activité enregistrée pour ce membre.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative space-y-0">
        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border" />

        <div className="space-y-4">
          {logs.map((log) => {
            const cfg = ACTION_CONFIG[log.action] ?? {
              label: log.action,
              icon:  <PencilIcon className="size-3.5" />,
              color: "bg-gray-100 text-gray-700",
            }

            return (
              <div key={log.id} className="relative flex gap-3 pl-1">
                <div className={cn("relative z-10 flex size-[30px] shrink-0 items-center justify-center rounded-full border", cfg.color)}>
                  {cfg.icon}
                </div>

                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <p className="text-sm font-medium leading-tight">{cfg.label}</p>
                    <time className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {format(new Date(log.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
                    </time>
                  </div>

                  {log.actorName && (
                    <p className="text-xs text-muted-foreground mt-0.5">par {log.actorName}</p>
                  )}

                  {(log.action === "MEMBRE_UPDATED" || log.action === "PROFIL_UPDATED") && log.metadata?.changes && (
                    <ChangeDiff changes={log.metadata.changes} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {(hasNextPage || logs.length < total) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>{logs.length} de {total} action{total !== 1 ? "s" : ""}</span>
          {hasNextPage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="h-7 text-xs"
            >
              {isFetchingNextPage ? (
                <><LoaderCircleIcon className="size-3 animate-spin mr-1.5" />Chargement…</>
              ) : (
                "Voir plus"
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
