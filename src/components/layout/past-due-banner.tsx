"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { WarningCircleIcon, ClockIcon } from "@phosphor-icons/react/dist/ssr";

type BillingStatus = { subscriptionStatus: string | null; paymentPending: boolean }

export function PastDueBanner() {
  const { data } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn:  () => fetch("/api/billing").then(r => r.json()),
  })

  // Cosmetic only (see subscriptionPaymentPending in src/lib/stripe.ts) — a SEPA Direct
  // Debit mandate that was just confirmed, still mid-settlement. Checked before the
  // PAST_DUE case below: a retry can still be processing even after the subscription
  // already flipped to PAST_DUE from an earlier failure, and that in-flight attempt should
  // read as "still waiting on the bank", not "payment failed, please fix it" — subscription
  // access itself is unaffected either way.
  if (data?.paymentPending) {
    return (
      <div className="flex items-center justify-center gap-2 bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 text-xs font-medium px-4 py-2 text-center">
        <ClockIcon className="size-3.5 shrink-0" />
        <span>
          Le prélèvement SEPA de votre abonnement est en cours de traitement. Cela peut prendre quelques jours ouvrés avant d&apos;apparaître sur votre compte bancaire.
        </span>
      </div>
    )
  }

  if (data?.subscriptionStatus === "PAST_DUE") {
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

  return null
}
