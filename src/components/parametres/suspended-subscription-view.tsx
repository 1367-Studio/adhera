"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { signOut } from "next-auth/react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
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
  trialExpired,
}: {
  canEdit:             boolean
  subscriptionStatus:  "SUSPENDED" | "CANCELLED"
  suspendedAt:         string | null
  // CANCELLED because a card-free trial ran out with no payment method added (see
  // Association.trialExpiredAt) — same screen, but "your trial ended" wording rather
  // than "your subscription was cancelled", which the admin never did.
  trialExpired:        boolean
}) {
  const t                    = useTranslations("parametres.suspended")
  const tCommon              = useTranslations("common")
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
      if (returningFromBilling) toast.success(t("toasts.reactivated"))
      router.replace("/dashboard")
    }
  }, [status, returningFromBilling, router, t])

  useEffect(() => {
    if (!returningFromBilling) return
    const timeoutId = setTimeout(() => setPollTimedOut(true), POLL_TIMEOUT_MS)
    return () => clearTimeout(timeoutId)
  }, [returningFromBilling])

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/portal", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ returnTo: "standby" }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.location.href = url },
    onError:   (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/cancel", { method: "POST" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
    },
    onSuccess: () => { window.location.href = `${BASE_PATH}/login?suspended=1` },
    onError:   (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  // fetch + blob download (not a raw navigation) so a failure shows a toast and leaves
  // the user on this screen, instead of replacing the whole page with a raw JSON error.
  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetch("/api/billing/export")
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = `export_donnees_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
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
            <CardTitle>
              {isCancelled ? (trialExpired ? t("titleTrialExpired") : t("titleCancelled")) : t("titleSuspended")}
            </CardTitle>
          </div>
          <CardDescription>
            {polling ? (
              t("pollingText")
            ) : isCancelled && trialExpired ? (
              t("trialExpiredDesc", { action: canEdit ? t("trialExpiredDescCanEdit") : t("trialExpiredDescCannotEdit") })
            ) : isCancelled ? (
              t("cancelledDesc", { action: canEdit ? t("cancelledDescCanEdit") : t("cancelledDescCannotEdit") })
            ) : (
              <>
                {suspendedSinceLabel
                  ? t("suspendedDescWithDate", { date: suspendedSinceLabel })
                  : t("suspendedDescNoDate")}
                {" "}
                {t("suspendedDescSuffix", { action: canEdit ? t("suspendedDescCanEdit") : t("suspendedDescCannotEdit") })}
              </>
            )}
            {returningFromBilling && pollTimedOut && (
              <span className="block mt-1 text-destructive">
                {t("pollTimeout")}
              </span>
            )}
          </CardDescription>
        </CardHeader>

        {canEdit && (
          <CardContent className="flex flex-col gap-2">
            {isCancelled ? (
              <Button onClick={() => router.push("/dashboard/reactiver-abonnement")}>
                <ArrowClockwiseIcon className="mr-2 size-4" />
                {trialExpired ? t("subscribe") : t("resubscribe")}
              </Button>
            ) : (
              <Button loading={portalMutation.isPending} onClick={() => portalMutation.mutate()}>
                <ArrowClockwiseIcon className="mr-2 size-4" />
                {t("reactivate")}
              </Button>
            )}
            <Button variant="outline" loading={exporting} onClick={handleExport}>
              <DownloadSimpleIcon className="mr-2 size-4" />
              {t("exportData")}
            </Button>
          </CardContent>
        )}

        <CardFooter className="justify-between border-t pt-4">
          {canEdit && !isCancelled ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
              {t("cancelForever")}
            </Button>
          ) : <span />}
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: `${BASE_PATH}/login` })}>
            <SignOutIcon className="mr-2 size-4" />
            {t("signOut")}
          </Button>
        </CardFooter>
      </Card>

      {canEdit && !isCancelled && (
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title={t("cancelDialog.title")}
          description={t("cancelDialog.description")}
          confirmLabel={cancelMutation.isPending ? t("cancelDialog.confirming") : t("cancelDialog.confirmLabel")}
          loading={cancelMutation.isPending}
          onConfirm={() => cancelMutation.mutateAsync()}
        />
      )}
    </div>
  )
}
