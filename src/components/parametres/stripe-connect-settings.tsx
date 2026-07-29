"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { ArrowSquareOutIcon, CheckCircleIcon, ClockIcon, WarningCircleIcon, CreditCardIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { apiErrorMessage } from "@/lib/api-error"
import { useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"

type ConnectStatus = {
  status:           "not_connected" | "incomplete" | "pending" | "enabled" | "invalid"
  chargesEnabled?:  boolean
  detailsSubmitted?: boolean
  payoutsEnabled?:  boolean
  requirements?:    string[]
}

function useStatusConfig() {
  const t = useTranslations("parametres.stripeConnect")
  return {
    not_connected: { label: t("status.notConnected"), variant: "secondary" as const, icon: <CreditCardIcon  className="size-3.5" /> },
    incomplete:    { label: t("status.incomplete"),    variant: "secondary" as const, icon: <WarningCircleIcon className="size-3.5 text-yellow-500" /> },
    pending:       { label: t("status.pending"),       variant: "outline"   as const, icon: <ClockIcon        className="size-3.5 text-blue-500"   /> },
    enabled:       { label: t("status.enabled"),       variant: "default"   as const, icon: <CheckCircleIcon  className="size-3.5 text-green-500"  /> },
    invalid:       { label: t("status.invalid"),       variant: "destructive" as const, icon: <WarningCircleIcon className="size-3.5" /> },
  }
}

export function StripeConnectSettings({ canEdit }: { canEdit: boolean }) {
  return (
    <Suspense fallback={null}>
      <StripeConnectSettingsInner canEdit={canEdit} />
    </Suspense>
  )
}

// useSearchParams() (for the Stripe Connect return redirect) requires a Suspense
// boundary above it, or `next build` fails prerendering whatever page renders this.
function StripeConnectSettingsInner({ canEdit }: { canEdit: boolean }) {
  const t             = useTranslations("parametres.stripeConnect")
  const tCommon       = useTranslations("common")
  const statusConfig  = useStatusConfig()
  const searchParams = useSearchParams()
  const qc           = useQueryClient()

  const { data, isLoading, refetch } = useQuery<ConnectStatus>({
    queryKey: ["connect-status"],
    queryFn:  () => fetch("/api/connect/status").then(r => r.json()),
  })

  useEffect(() => {
    const result = searchParams.get("connect")
    if (result === "success") {
      refetch()
      qc.invalidateQueries({ queryKey: ["portal-connect-status"] })
      toast.success(t("toasts.updated"))
    } else if (result === "refresh") {
      toast.info(t("toasts.notFinalized"))
    }
  }, [searchParams, refetch, qc, t])

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connect/onboard", { method: "POST" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.location.href = url },
    onError:   (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const dashboardMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connect/dashboard-link", { method: "POST" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.open(url, "_blank") },
    onError:   (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const status = data?.status ?? "not_connected"
  const cfg    = statusConfig[status]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        {!isLoading && (
          <Badge variant={cfg.variant} className="gap-1.5">
            {cfg.icon}
            {cfg.label}
          </Badge>
        )}
      </div>

      {!isLoading && (
        <div className="space-y-3">
          {status === "enabled" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("enabledText")}
              </p>
              <div className="flex gap-2">
                {canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={onboardMutation.isPending}
                      onClick={() => onboardMutation.mutate()}
                    >
                      {t("editAccount")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={dashboardMutation.isPending}
                      onClick={() => dashboardMutation.mutate()}
                    >
                      <ArrowSquareOutIcon className="size-3.5 mr-1.5" />
                      {t("dashboardButton")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : status === "pending" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("pendingText")}
              </p>
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={onboardMutation.isPending}
                  onClick={() => onboardMutation.mutate()}
                >
                  {t("completeOnboarding")}
                </Button>
              )}
            </div>
          ) : status === "invalid" ? (
            <div className="space-y-2">
              <p className="text-xs text-destructive">
                {t("invalidText")}
              </p>
              {canEdit && (
                <Button
                  size="sm"
                  loading={onboardMutation.isPending}
                  onClick={() => onboardMutation.mutate()}
                >
                  {t("reconnect")}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("connectText")}
              </p>
              {canEdit && (
                <Button
                  size="sm"
                  loading={onboardMutation.isPending}
                  onClick={() => onboardMutation.mutate()}
                >
                  {t("connect")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
