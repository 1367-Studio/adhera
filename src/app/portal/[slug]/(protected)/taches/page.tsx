"use client"

import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { CheckSquareIcon, WarningCircleIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { usePortalTaches, useUpdatePortalTacheStatus, useCompletePortalTache } from "@/hooks/use-taches"
import { isTacheOverdue, tacheDueDateLocal } from "@/lib/tache-status"

export default function TachesPortalPage() {
  const t = useTranslations("taches.portalPage")
  const tCommon = useTranslations("common")
  const { data: taches = [], isLoading } = usePortalTaches()
  const updateStatus = useUpdatePortalTacheStatus()
  const completeTache = useCompletePortalTache()

  async function handleStartWork(id: string) {
    try {
      await updateStatus.mutateAsync({ id, status: "EN_COURS" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  async function handleComplete(id: string) {
    try {
      await completeTache.mutateAsync(id)
      toast.success(t("toasts.completed"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  const open = taches.filter(tache => tache.status !== "TERMINEE")
  const done = taches.filter(tache => tache.status === "TERMINEE")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map(i => (
            <div key={i} className="rounded-lg border p-5 animate-pulse space-y-2">
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : taches.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center space-y-3">
          <CheckSquareIcon className="size-10 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <div className="space-y-3">
              {open.map(tache => {
                const overdue = isTacheOverdue(tache)
                const statusConfig = {
                  A_FAIRE:  { label: t("status.aFaire"),  variant: "secondary" as const },
                  EN_COURS: { label: t("status.enCours"), variant: "warning" as const },
                }[tache.status as "A_FAIRE" | "EN_COURS"]
                return (
                  <div key={tache.id} className="rounded-lg border bg-card p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{tache.titre}</span>
                          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                          {overdue && (
                            <Badge variant="destructive"><WarningCircleIcon className="size-3" /> {t("status.enRetard")}</Badge>
                          )}
                        </div>
                        {tache.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{tache.description}</p>
                        )}
                        <p className={overdue ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                          {tache.dueDate
                            ? t("echeance", { date: format(tacheDueDateLocal(tache.dueDate), "d MMM yyyy", { locale: fr }) })
                            : t("sansEcheance")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {tache.status === "A_FAIRE" && (
                        <Button size="sm" variant="outline" onClick={() => handleStartWork(tache.id)} loading={updateStatus.isPending}>
                          {t("startWork")}
                        </Button>
                      )}
                      <Button size="sm" onClick={() => handleComplete(tache.id)} loading={completeTache.isPending}>
                        <CheckCircleIcon className="size-4" />
                        {t("markComplete")}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {done.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">{t("history")}</p>
              {done.map(tache => (
                <div key={tache.id} className="rounded-lg border bg-card p-5">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-sm">{tache.titre}</span>
                    <Badge variant="success">{t("status.terminee")}</Badge>
                  </div>
                  {tache.completedAt && (
                    <p className="text-xs text-muted-foreground">
                      {t("completedOn", { date: format(new Date(tache.completedAt), "d MMM yyyy", { locale: fr }) })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
