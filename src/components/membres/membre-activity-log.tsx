"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useTranslations } from "next-intl"
import { UserPlusIcon, PencilSimpleIcon, TrashIcon, GlobeIcon, CircleNotchIcon, WarningCircleIcon, MoneyIcon, ArrowElbowDownLeftIcon, PackageIcon, XIcon, ShieldIcon, LockIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type Translator = ReturnType<typeof useTranslations>

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

function getFieldLabels(t: Translator): Record<string, string> {
  return {
    firstName: t("membres.activityLog.fields.firstName"),
    lastName:  t("membres.activityLog.fields.lastName"),
    name:      t("membres.activityLog.fields.name"),
    email:     t("membres.activityLog.fields.email"),
    phone:     t("membres.activityLog.fields.phone"),
    address:   t("membres.activityLog.fields.address"),
    birthDate: t("membres.activityLog.fields.birthDate"),
    status:    t("membres.activityLog.fields.status"),
    typeId:    t("membres.activityLog.fields.typeId"),
    role:      t("membres.activityLog.fields.role"),
    adherentOverride: t("membres.activityLog.fields.adherentOverride"),
  }
}

function getStatusLabels(t: Translator): Record<string, string> {
  return {
    ACTIF:    t("membres.form.status.actif"),
    INACTIF:  t("membres.form.status.inactif"),
    PENDING:  t("membres.form.status.pending"),
    SUSPENDU: t("membres.form.status.suspendu"),
  }
}

function getAdherentOverrideLabels(t: Translator): Record<string, string> {
  return {
    true:  t("membres.activityLog.adherentOverrideValues.forcedAdherent"),
    false: t("membres.activityLog.adherentOverrideValues.forcedBenevole"),
  }
}

function getRoleLabels(t: Translator): Record<string, string> {
  return {
    ADMIN: t("membres.form.role.admin"), PRESIDENT: t("membres.form.role.president"), TRESORIER: t("membres.form.role.tresorier"),
    SECRETAIRE: t("membres.form.role.secretaire"), MEMBRE: t("membres.form.role.membre"),
  }
}

function getActionConfig(t: Translator): Record<string, { label: string; icon: React.ReactNode; color: string }> {
  return {
    MEMBRE_CREATED:           { label: t("membres.activityLog.actions.membreCreated"),          icon: <UserPlusIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    MEMBRE_UPDATED:           { label: t("membres.activityLog.actions.membreUpdated"), icon: <PencilSimpleIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
    PROFIL_UPDATED:           { label: t("membres.activityLog.actions.profilUpdated"),         icon: <PencilSimpleIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
    PROFILE_UPDATED:          { label: t("membres.activityLog.actions.profileUpdated"),         icon: <PencilSimpleIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
    MEMBRE_ROLE_CHANGED:      { label: t("membres.activityLog.actions.membreRoleChanged"),           icon: <ShieldIcon   className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"                },
    PASSWORD_CHANGED:         { label: t("membres.activityLog.actions.passwordChanged"),   icon: <LockIcon     className="size-3.5" />, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"                   },
    PASSWORD_RESET:           { label: t("membres.activityLog.actions.passwordReset"), icon: <LockIcon  className="size-3.5" />, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"                   },
    MEMBRE_DELETED:           { label: t("membres.activityLog.actions.membreDeleted"),         icon: <TrashIcon   className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"               },
    MEMBRE_PORTAL_REGISTERED: { label: t("membres.activityLog.actions.membrePortalRegistered"),    icon: <GlobeIcon    className="size-3.5" />, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"   },
    MEMBRE_INSCRIPTION_REQUESTED: { label: t("membres.activityLog.actions.membreInscriptionRequested"), icon: <GlobeIcon className="size-3.5" />, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
    COTISATION_CREATED:  { label: t("membres.activityLog.actions.cotisationCreated"),   icon: <MoneyIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    COTISATION_UPDATED:  { label: t("membres.activityLog.actions.cotisationUpdated"),  icon: <PencilSimpleIcon className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
    COTISATION_DELETED:  { label: t("membres.activityLog.actions.cotisationDeleted"), icon: <TrashIcon className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"                     },
    COTISATION_PAID:     { label: t("membres.activityLog.actions.cotisationPaid"),     icon: <MoneyIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    COTISATION_REFUNDED: { label: t("membres.activityLog.actions.cotisationRefunded"), icon: <ArrowElbowDownLeftIcon className="size-3.5" />, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    LOAN_CREATED:   { label: t("membres.activityLog.actions.loanCreated"),    icon: <PackageIcon className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"         },
    LOAN_REQUESTED: { label: t("membres.activityLog.actions.loanRequested"),             icon: <PackageIcon className="size-3.5" />, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
    LOAN_CONFIRMED: { label: t("membres.activityLog.actions.loanConfirmed"),            icon: <PackageIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    LOAN_REFUSED:   { label: t("membres.activityLog.actions.loanRefused"),              icon: <XIcon className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"             },
    LOAN_RETURNED:  { label: t("membres.activityLog.actions.loanReturned"),           icon: <ArrowElbowDownLeftIcon className="size-3.5" />, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    LOAN_UPDATED:   { label: t("membres.activityLog.actions.loanUpdated"),             icon: <PencilSimpleIcon className="size-3.5" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
    LOAN_CANCELLED: { label: t("membres.activityLog.actions.loanCancelled"),              icon: <XIcon className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"             },
    LOAN_DELETED:   { label: t("membres.activityLog.actions.loanDeleted"),            icon: <TrashIcon className="size-3.5" />, color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"             },
  }
}

function formatFieldValue(value: string | null, statusLabels: Record<string, string>, roleLabels: Record<string, string>, adherentOverrideLabels: Record<string, string>, field: string): string {
  if (value === null || value === "") return "—"
  if (field === "status") return statusLabels[value] ?? value
  if (field === "role")   return roleLabels[value] ?? value
  if (field === "adherentOverride") return adherentOverrideLabels[value] ?? value
  return value
}

function ChangeDiff({ changes, t }: { changes: Record<string, FieldDiff>; t: Translator }) {
  const entries = Object.entries(changes)
  if (entries.length === 0) return null
  const fieldLabels = getFieldLabels(t)
  const statusLabels = getStatusLabels(t)
  const roleLabels = getRoleLabels(t)
  const adherentOverrideLabels = getAdherentOverrideLabels(t)
  return (
    <div className="mt-1.5 space-y-0.5">
      {entries.map(([field, diff]) => (
        <p key={field} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{fieldLabels[field] ?? field}</span>
          {" : "}
          <span className="line-through opacity-60">{formatFieldValue(diff.old, statusLabels, roleLabels, adherentOverrideLabels, field)}</span>
          {" → "}
          <span>{formatFieldValue(diff.new, statusLabels, roleLabels, adherentOverrideLabels, field)}</span>
        </p>
      ))}
    </div>
  )
}

export function MembreActivityLog({ membreId }: { membreId: string }) {
  const t = useTranslations()
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
        <span className="text-sm">{t("common.loading")}</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <WarningCircleIcon className="size-4 shrink-0" />
        {t("membres.activityLog.loadError")}
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        {t("membres.activityLog.empty")}
      </p>
    )
  }

  const actionConfig = getActionConfig(t)

  return (
    <div className="space-y-4">
      <div className="relative space-y-0">
        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border" />

        <div className="space-y-4">
          {logs.map((log) => {
            const cfg = actionConfig[log.action] ?? {
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
                    <p className="text-xs text-muted-foreground mt-0.5">{t("membres.activityLog.actorPrefix", { name: log.actorName })}</p>
                  )}

                  {["MEMBRE_UPDATED", "PROFIL_UPDATED", "PROFILE_UPDATED", "MEMBRE_ROLE_CHANGED"].includes(log.action) && log.metadata?.changes && (
                    <ChangeDiff changes={log.metadata.changes} t={t} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {(hasNextPage || logs.length < total) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>{t("membres.activityLog.shownOfTotal", { shown: logs.length, total })}</span>
          {hasNextPage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="h-7 text-xs"
            >
              {isFetchingNextPage ? (
                <><CircleNotchIcon className="size-3 animate-spin mr-1.5" />{t("common.loading")}</>
              ) : (
                t("membres.activityLog.loadMore")
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
