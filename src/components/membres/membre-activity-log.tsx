"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { UserPlusIcon, PencilSimpleIcon, TrashIcon, GlobeIcon, CircleNotchIcon, WarningCircleIcon, MoneyIcon, ArrowElbowDownLeftIcon, PackageIcon, XIcon, ShieldIcon, LockIcon } from "@phosphor-icons/react/dist/ssr";
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
  name:      "Nom",
  email:     "Email",
  phone:     "Téléphone",
  address:   "Adresse",
  birthDate: "Date de naissance",
  status:    "Statut",
  typeId:    "Type",
  role:      "Rôle",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIF:    "Actif",
  INACTIF:  "Inactif",
  PENDING:  "En attente",
  SUSPENDU: "Suspendu",
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin", PRESIDENT: "Président", TRESORIER: "Trésorier",
  SECRETAIRE: "Secrétaire", MEMBRE: "Membre",
}

const ACTION_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  MEMBRE_CREATED:           { label: "Membre ajouté",          icon: <UserPlusIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  MEMBRE_UPDATED:           { label: "Informations modifiées", icon: <PencilSimpleIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
  PROFIL_UPDATED:           { label: "Profil modifié",         icon: <PencilSimpleIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
  PROFILE_UPDATED:          { label: "Profil modifié",         icon: <PencilSimpleIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
  MEMBRE_ROLE_CHANGED:      { label: "Rôle modifié",           icon: <ShieldIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"                },
  PASSWORD_CHANGED:         { label: "Mot de passe modifié",   icon: <LockIcon     className="size-3.5" />, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"                   },
  PASSWORD_RESET:           { label: "Mot de passe réinitialisé", icon: <LockIcon  className="size-3.5" />, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"                   },
  MEMBRE_DELETED:           { label: "Membre archivé",         icon: <TrashIcon   className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"               },
  MEMBRE_PORTAL_REGISTERED: { label: "Inscription portail",    icon: <GlobeIcon    className="size-3.5" />, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"   },
  MEMBRE_INSCRIPTION_REQUESTED: { label: "Demande d'adhésion (site)", icon: <GlobeIcon className="size-3.5" />, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  COTISATION_CREATED:  { label: "Cotisation ajoutée",   icon: <MoneyIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  COTISATION_UPDATED:  { label: "Cotisation modifiée",  icon: <PencilSimpleIcon className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
  COTISATION_DELETED:  { label: "Cotisation supprimée", icon: <TrashIcon className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"                     },
  COTISATION_PAID:     { label: "Cotisation payée",     icon: <MoneyIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  COTISATION_REFUNDED: { label: "Cotisation remboursée", icon: <ArrowElbowDownLeftIcon className="size-3.5" />, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  LOAN_CREATED:   { label: "Prêt de matériel créé",    icon: <PackageIcon className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"         },
  LOAN_REQUESTED: { label: "Prêt demandé",             icon: <PackageIcon className="size-3.5" />, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  LOAN_CONFIRMED: { label: "Prêt confirmé",            icon: <PackageIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  LOAN_REFUSED:   { label: "Prêt refusé",              icon: <XIcon className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"             },
  LOAN_RETURNED:  { label: "Matériel rendu",           icon: <ArrowElbowDownLeftIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  LOAN_UPDATED:   { label: "Prêt modifié",             icon: <PencilSimpleIcon className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
  LOAN_CANCELLED: { label: "Prêt annulé",              icon: <XIcon className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"             },
  LOAN_DELETED:   { label: "Prêt supprimé",            icon: <TrashIcon className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"             },
}

function formatFieldValue(field: string, value: string | null): string {
  if (value === null || value === "") return "—"
  if (field === "status") return STATUS_LABELS[value] ?? value
  if (field === "role")   return ROLE_LABELS[value] ?? value
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
        <CircleNotchIcon className="size-4 animate-spin mr-2" />
        <span className="text-sm">Chargement…</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <WarningCircleIcon className="size-4 shrink-0" />
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
              icon:  <PencilSimpleIcon className="size-3.5" />,
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

                  {["MEMBRE_UPDATED", "PROFIL_UPDATED", "PROFILE_UPDATED", "MEMBRE_ROLE_CHANGED"].includes(log.action) && log.metadata?.changes && (
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
                <><CircleNotchIcon className="size-3 animate-spin mr-1.5" />Chargement…</>
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
