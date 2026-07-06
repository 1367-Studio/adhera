"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLinkIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon, CreditCardIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { apiErrorMessage } from "@/lib/api-error"
import { useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"

type ConnectStatus = {
  status:           "not_connected" | "incomplete" | "pending" | "enabled"
  chargesEnabled?:  boolean
  detailsSubmitted?: boolean
  payoutsEnabled?:  boolean
  requirements?:    string[]
}

const statusConfig = {
  not_connected: { label: "Non connecté",  variant: "secondary" as const, icon: <CreditCardIcon  className="size-3.5" /> },
  incomplete:    { label: "Incomplet",     variant: "secondary" as const, icon: <AlertCircleIcon className="size-3.5 text-yellow-500" /> },
  pending:       { label: "En attente",    variant: "outline"   as const, icon: <ClockIcon        className="size-3.5 text-blue-500"   /> },
  enabled:       { label: "Actif",         variant: "default"   as const, icon: <CheckCircleIcon  className="size-3.5 text-green-500"  /> },
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
      toast.success("Compte Stripe mis à jour")
    } else if (result === "refresh") {
      toast.info("La connexion Stripe n'a pas été finalisée. Réessayez si nécessaire.")
    }
  }, [searchParams, refetch, qc])

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connect/onboard", { method: "POST" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.location.href = url },
    onError:   (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const dashboardMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connect/dashboard-link", { method: "POST" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.open(url, "_blank") },
    onError:   (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const status = data?.status ?? "not_connected"
  const cfg    = statusConfig[status]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Paiement en ligne (Stripe)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Permettez à vos membres de payer leur cotisation en ligne.
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
                Vos membres peuvent payer leur cotisation en ligne. Les fonds sont versés directement sur votre compte Stripe.
                Une commission de 1,5 % est prélevée par la plateforme.
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
                      Modifier le compte
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={dashboardMutation.isPending}
                      onClick={() => dashboardMutation.mutate()}
                    >
                      <ExternalLinkIcon className="size-3.5 mr-1.5" />
                      Dashboard Stripe
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : status === "pending" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Votre compte est en cours de vérification par Stripe. Vous recevrez un email de confirmation.
              </p>
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={onboardMutation.isPending}
                  onClick={() => onboardMutation.mutate()}
                >
                  Compléter l'inscription
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Connectez un compte Stripe pour activer le paiement en ligne des cotisations.
                Une commission de 1,5 % sera prélevée par la plateforme.
              </p>
              {canEdit && (
                <Button
                  size="sm"
                  loading={onboardMutation.isPending}
                  onClick={() => onboardMutation.mutate()}
                >
                  Connecter Stripe
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
