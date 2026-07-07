"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";

type BillingStatus = { subscriptionStatus: string | null }

export function PastDueBanner() {
  const { data } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn:  () => fetch("/api/billing").then(r => r.json()),
  })

  if (data?.subscriptionStatus !== "PAST_DUE") return null

  return (
    <div className="flex items-center justify-center gap-2 bg-destructive/10 text-destructive text-xs font-medium px-4 py-2 text-center">
      <WarningCircleIcon className="size-3.5 shrink-0" />
      <span>
        Le dernier prélèvement de votre abonnement a échoué.{" "}
        <Link href="/dashboard/parametres?tab=abonnement" className="underline underline-offset-2">
          Mettez à jour votre moyen de paiement
        </Link>{" "}
        pour éviter une suspension de votre compte.
      </span>
    </div>
  )
}
