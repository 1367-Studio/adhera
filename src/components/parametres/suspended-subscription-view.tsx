"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { signOut } from "next-auth/react"
import { toast } from "sonner"
import { WarningCircleIcon, DownloadSimpleIcon, ArrowClockwiseIcon, SignOutIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { apiErrorMessage } from "@/lib/api-error"
import { BASE_PATH } from "@/lib/env"

type BillingStatus = { subscriptionStatus: string | null; suspendedAt: string | null }

const POLL_TIMEOUT_MS = 30_000

export function SuspendedSubscriptionView({
  canEdit,
  subscriptionStatus,
  suspendedAt,
}: {
  canEdit:             boolean
  subscriptionStatus:  "SUSPENDED" | "CANCELLED"
  suspendedAt:         string | null
}) {
  const router               = useRouter()
  const searchParams         = useSearchParams()
  const returningFromBilling = searchParams.get("billing") === "updated"

  const [cancelOpen, setCancelOpen]     = useState(false)
  const [exporting, setExporting]       = useState(false)
  const [pollTimedOut, setPollTimedOut] = useState(false)

  const polling = returningFromBilling && !pollTimedOut

  // Coming back from the Stripe billing portal after paying — the webhook that confirms
  // it and flips subscriptionStatus can lag a few seconds behind the redirect, so poll
  // briefly instead of just showing "still suspended" the instant they land back here.
  const { data } = useQuery<BillingStatus>({
    queryKey:        ["billing-status"],
    queryFn:         () => fetch("/api/billing").then(r => r.json()),
    initialData:     { subscriptionStatus, suspendedAt },
    refetchInterval: polling ? 2000 : false,
  })

  const status = data?.subscriptionStatus ?? subscriptionStatus
  const isCancelled = status === "CANCELLED"

  useEffect(() => {
    if (status !== "SUSPENDED" && status !== "CANCELLED") {
      if (returningFromBilling) toast.success("Abonnement réactivé !")
      router.replace("/dashboard")
    }
  }, [status, returningFromBilling, router])

  useEffect(() => {
    if (!returningFromBilling) return
    const t = setTimeout(() => setPollTimedOut(true), POLL_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [returningFromBilling])

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/portal", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ returnTo: "standby" }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.location.href = url },
    onError:   (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/cancel", { method: "POST" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
    },
    onSuccess: () => { window.location.href = `${BASE_PATH}/login?suspended=1` },
    onError:   (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  // fetch + blob download (not a raw navigation) so a failure shows a toast and leaves
  // the user on this screen, instead of replacing the whole page with a raw JSON error.
  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetch("/api/billing/export")
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = `export_donnees_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    } finally {
      setExporting(false)
    }
  }

  const suspendedSinceLabel = data?.suspendedAt
    ? new Date(data.suspendedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <WarningCircleIcon className="size-5" />
            <CardTitle>{isCancelled ? "Abonnement résilié" : "Abonnement suspendu"}</CardTitle>
          </div>
          <CardDescription>
            {polling ? (
              "Nous confirmons votre paiement, merci de patienter quelques secondes..."
            ) : isCancelled ? (
              <>
                Votre abonnement a été résilié et l&apos;accès au tableau de bord est bloqué. Vos données sont conservées
                {" "}: {canEdit
                  ? "vous pouvez les exporter ou vous réabonner à tout moment."
                  : "contactez un administrateur de l'association pour réabonner l'association."}
              </>
            ) : (
              <>
                {suspendedSinceLabel
                  ? `Les derniers prélèvements ont échoué et votre abonnement est suspendu depuis le ${suspendedSinceLabel}.`
                  : "Les derniers prélèvements ont échoué et votre abonnement est suspendu."}
                {" "}L&apos;accès au tableau de bord est bloqué jusqu&apos;à réactivation. Vos données sont conservées
                {" "}: {canEdit
                  ? "vous pouvez les exporter ou annuler définitivement à tout moment."
                  : "contactez un administrateur de l'association pour réactiver l'abonnement."}
              </>
            )}
            {returningFromBilling && pollTimedOut && (
              <span className="block mt-1 text-destructive">
                La confirmation prend plus de temps que prévu. Rafraîchissez la page dans un instant.
              </span>
            )}
          </CardDescription>
        </CardHeader>

        {canEdit && (
          <CardContent className="flex flex-col gap-2">
            {isCancelled ? (
              <Button onClick={() => router.push("/dashboard/reactiver-abonnement")}>
                <ArrowClockwiseIcon className="mr-2 size-4" />
                Se réabonner
              </Button>
            ) : (
              <Button loading={portalMutation.isPending} onClick={() => portalMutation.mutate()}>
                <ArrowClockwiseIcon className="mr-2 size-4" />
                Réactiver mon abonnement
              </Button>
            )}
            <Button variant="outline" loading={exporting} onClick={handleExport}>
              <DownloadSimpleIcon className="mr-2 size-4" />
              Exporter mes données
            </Button>
          </CardContent>
        )}

        <CardFooter className="justify-between border-t pt-4">
          {canEdit && !isCancelled ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
              Annuler définitivement mon abonnement
            </Button>
          ) : <span />}
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: `${BASE_PATH}/login` })}>
            <SignOutIcon className="mr-2 size-4" />
            Se déconnecter
          </Button>
        </CardFooter>
      </Card>

      {canEdit && !isCancelled && (
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title="Annuler définitivement l'abonnement"
          description="Votre compte sera fermé et l'accès à la plateforme définitivement coupé pour tous les membres. Cette action est irréversible."
          confirmLabel={cancelMutation.isPending ? "Annulation..." : "Confirmer l'annulation"}
          loading={cancelMutation.isPending}
          onConfirm={() => cancelMutation.mutateAsync()}
        />
      )}
    </div>
  )
}
