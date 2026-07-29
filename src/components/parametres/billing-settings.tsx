"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { CheckCircleIcon, ClockIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { apiErrorMessage } from "@/lib/api-error"

type BillingStatus = {
  subscriptionStatus:  "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | null
  trialEndsAt:         string | null
  cancelAtPeriodEnd:   boolean
  currentPeriodEndsAt: string | null
  hasBilling:          boolean
  plan:                "essential" | "pro"
  memberCount:         number
  memberLimit:         number
}

function useStatusConfig() {
  const t = useTranslations("parametres.billing")
  return {
    TRIAL:     { label: t("status.trial"),     variant: "outline"     as const, icon: <ClockIcon         className="size-3.5 text-blue-500"   /> },
    ACTIVE:    { label: t("status.active"),    variant: "default"     as const, icon: <CheckCircleIcon   className="size-3.5 text-green-500"  /> },
    PAST_DUE:  { label: t("status.pastDue"),   variant: "destructive" as const, icon: <WarningCircleIcon className="size-3.5" /> },
    SUSPENDED: { label: t("status.suspended"), variant: "destructive" as const, icon: <WarningCircleIcon className="size-3.5" /> },
    CANCELLED: { label: t("status.cancelled"), variant: "secondary"   as const, icon: <XCircleIcon       className="size-3.5" /> },
  }
}

export function BillingSettings({ canEdit }: { canEdit: boolean }) {
  const t             = useTranslations("parametres.billing")
  const tCommon       = useTranslations("common")
  const tierLabels: Record<BillingStatus["plan"], string> = { essential: t("tier.essential"), pro: t("tier.pro") }
  const statusConfig  = useStatusConfig()
  const qc           = useQueryClient()
  const searchParams = useSearchParams()

  const { data, isLoading, isError } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn:  () => fetch("/api/billing").then(r => r.json()),
  })

  // Retour du Customer Portal Stripe (annulation, changement de carte...) — le
  // statut a pu changer côté Stripe pendant l'absence, on force un refetch.
  useEffect(() => {
    if (searchParams.get("billing") === "updated") {
      qc.invalidateQueries({ queryKey: ["billing-status"] })
    }
  }, [searchParams, qc])

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.location.href = url },
    onError:   (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const status = data?.subscriptionStatus ?? null
  const cfg    = status ? statusConfig[status] : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        {!isLoading && cfg && (
          <Badge variant={cfg.variant} className="gap-1.5">
            {cfg.icon}
            {cfg.label}
          </Badge>
        )}
      </div>

      {!isLoading && !isError && data && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <span className="font-medium">{t("planLabel", { tier: tierLabels[data.plan] })}</span>
          <span className={data.memberCount >= data.memberLimit ? "font-medium text-destructive" : "text-muted-foreground"}>
            {t("membersCount", { count: data.memberCount, limit: data.memberLimit })}
          </span>
        </div>
      )}

      {!isLoading && isError && (
        <p className="text-xs text-destructive">
          {t("loadError")}
        </p>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {status === "TRIAL" && data?.trialEndsAt && (
            <p className="text-xs text-muted-foreground">
              {t("trialEndsAt", { date: new Date(data.trialEndsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) })}
            </p>
          )}

          {status === "ACTIVE" && (
            <p className="text-xs text-muted-foreground">
              {t("activeText")}
            </p>
          )}

          {status === "PAST_DUE" && (
            <p className="text-xs text-destructive">
              {t("pastDueText")}
            </p>
          )}

          {/* Defensive only: src/proxy.ts redirects every SUSPENDED admin away from
              /dashboard/parametres to /dashboard/abonnement-suspendu before this component
              can render, so this branch shouldn't actually be reachable in normal use. */}
          {status === "SUSPENDED" && (
            <p className="text-xs text-destructive">
              {t("suspendedText")}
            </p>
          )}

          {status === "CANCELLED" && (
            <p className="text-xs text-muted-foreground">
              {t("cancelledText")}
            </p>
          )}

          {data?.cancelAtPeriodEnd && data?.currentPeriodEndsAt && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("cancelAtPeriodEnd", { date: new Date(data.currentPeriodEndsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) })}
            </p>
          )}

          {canEdit && data?.hasBilling && status !== "CANCELLED" && status !== "SUSPENDED" && (
            <Button
              size="sm"
              variant={status === "PAST_DUE" ? "default" : "outline"}
              loading={portalMutation.isPending}
              onClick={() => portalMutation.mutate()}
            >
              {status === "PAST_DUE" ? t("updatePayment") : t("manageSubscription")}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
