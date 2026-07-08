"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckCircleIcon, ClockIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { apiErrorMessage } from "@/lib/api-error"

type BillingStatus = {
  subscriptionStatus: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | null
  trialEndsAt:        string | null
  hasBilling:         boolean
}

const statusConfig = {
  TRIAL:     { label: "Essai gratuit",       variant: "outline"     as const, icon: <ClockIcon         className="size-3.5 text-blue-500"   /> },
  ACTIVE:    { label: "Actif",               variant: "default"     as const, icon: <CheckCircleIcon   className="size-3.5 text-green-500"  /> },
  PAST_DUE:  { label: "Paiement en retard",  variant: "destructive" as const, icon: <WarningCircleIcon className="size-3.5" /> },
  SUSPENDED: { label: "Suspendu",            variant: "destructive" as const, icon: <WarningCircleIcon className="size-3.5" /> },
  CANCELLED: { label: "Annulé",              variant: "secondary"   as const, icon: <XCircleIcon       className="size-3.5" /> },
}

export function BillingSettings({ canEdit }: { canEdit: boolean }) {
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
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.location.href = url },
    onError:   (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const status = data?.subscriptionStatus ?? null
  const cfg    = status ? statusConfig[status] : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Abonnement</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gérez votre abonnement à la plateforme et vos moyens de paiement.
          </p>
        </div>
        {!isLoading && cfg && (
          <Badge variant={cfg.variant} className="gap-1.5">
            {cfg.icon}
            {cfg.label}
          </Badge>
        )}
      </div>

      {!isLoading && isError && (
        <p className="text-xs text-destructive">
          Impossible de récupérer votre statut d'abonnement. Réessayez plus tard.
        </p>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {status === "TRIAL" && data?.trialEndsAt && (
            <p className="text-xs text-muted-foreground">
              Votre essai gratuit se termine le{" "}
              {new Date(data.trialEndsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
              Passé cette date, la carte enregistrée sera débitée automatiquement, sauf annulation avant cette date.
            </p>
          )}

          {status === "ACTIVE" && (
            <p className="text-xs text-muted-foreground">
              Votre abonnement est actif. Vous pouvez à tout moment consulter vos factures,
              changer de moyen de paiement ou annuler depuis l'espace de gestion Stripe.
            </p>
          )}

          {status === "PAST_DUE" && (
            <p className="text-xs text-destructive">
              Le dernier prélèvement a échoué. Mettez à jour votre moyen de paiement pour éviter
              une suspension de votre compte.
            </p>
          )}

          {/* Defensive only: src/proxy.ts redirects every SUSPENDED admin away from
              /dashboard/parametres to /dashboard/abonnement-suspendu before this component
              can render, so this branch shouldn't actually be reachable in normal use. */}
          {status === "SUSPENDED" && (
            <p className="text-xs text-destructive">
              Votre abonnement est suspendu suite à plusieurs échecs de paiement.
              Rendez-vous sur l&apos;écran dédié pour le réactiver, exporter vos données ou l&apos;annuler définitivement.
            </p>
          )}

          {status === "CANCELLED" && (
            <p className="text-xs text-muted-foreground">
              Votre abonnement a été annulé. Contactez le support pour le réactiver.
            </p>
          )}

          {canEdit && data?.hasBilling && status !== "CANCELLED" && status !== "SUSPENDED" && (
            <Button
              size="sm"
              variant={status === "PAST_DUE" ? "default" : "outline"}
              loading={portalMutation.isPending}
              onClick={() => portalMutation.mutate()}
            >
              {status === "PAST_DUE" ? "Mettre à jour le paiement" : "Gérer mon abonnement"}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
