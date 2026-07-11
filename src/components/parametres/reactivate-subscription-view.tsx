"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import type { PricingInfo, PlanTier } from "@/lib/stripe"
import { stripePromise, stripeAppearance, euros, PlanPicker, type Plan } from "@/components/billing/stripe-elements-shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CircleNotchIcon, LockIcon, ArrowLeftIcon, ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr"
import { apiErrorMessage } from "@/lib/api-error"
import { BASE_PATH } from "@/lib/env"

function PaymentForm({ tier, plan, pricing, clientSecret, onSuccess }: {
  tier:         PlanTier
  plan:         Plan
  pricing:      PricingInfo
  clientSecret: string
  onSuccess:    () => void
}) {
  const stripe   = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setError("")
    setLoading(true)

    try {
      let paymentMethodId: string

      const { error: stripeErr, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect:      "if_required",
        confirmParams: { return_url: window.location.origin + BASE_PATH + "/dashboard/reactiver-abonnement" },
      })

      if (stripeErr) {
        if (stripeErr.code === "setup_intent_unexpected_state") {
          const { setupIntent: existing } = await stripe.retrieveSetupIntent(clientSecret)
          if (existing?.status === "succeeded" && existing.payment_method) {
            paymentMethodId = existing.payment_method as string
          } else {
            throw new Error(stripeErr.message)
          }
        } else {
          throw new Error(stripeErr.message)
        }
      } else {
        if (!setupIntent?.payment_method) throw new Error("Erreur de paiement")
        paymentMethodId = setupIntent.payment_method as string
      }

      const res = await fetch("/api/billing/reactivate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ paymentMethodId, plan, tier }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la réactivation"))

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur")
    } finally {
      setLoading(false)
    }
  }

  const tierPricing  = pricing.plans[tier]
  const monthlyPrice = euros(tierPricing.monthlyAmountCents)
  const yearlyEquiv  = euros(Math.round(tierPricing.yearlyAmountCents / 12))
  const yearlyTotal  = euros(tierPricing.yearlyAmountCents)

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-xl border bg-card p-4 space-y-1.5 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Nouvel abonnement</span>
          <span className="font-medium text-foreground">
            {plan === "yearly" ? `${yearlyEquiv}/mois` : `${monthlyPrice}/mois`}
          </span>
        </div>
        {plan === "yearly" && (
          <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400">
            <span>Facturé en une fois</span>
            <span>{yearlyTotal}/an</span>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <PaymentElement
          options={{
            layout:        { type: "tabs", defaultCollapsed: false },
            defaultValues: { billingDetails: { address: { country: "FR" } } },
          }}
        />
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      <Button type="submit" className="w-full h-11 text-sm font-medium" disabled={loading || !stripe}>
        {loading && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
        Confirmer et réabonner
      </Button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="size-3" />
        <span>Paiement sécurisé par Stripe</span>
      </div>
    </form>
  )
}

export function ReactivateSubscriptionView({ pricing, initialTier }: { pricing: PricingInfo; initialTier: PlanTier }) {
  const router = useRouter()
  const [tier, setTier] = useState<PlanTier>(initialTier)
  const [plan, setPlan] = useState<Plan>("monthly")
  const [clientSecret, setClientSecret] = useState("")
  const [loadingIntent, setLoadingIntent] = useState(true)
  const [error, setError] = useState("")

  function loadSetupIntent() {
    setLoadingIntent(true)
    setError("")
    fetch("/api/billing/reactivate/setup-intent", { method: "POST" })
      .then(async res => {
        if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
        return res.json() as Promise<{ clientSecret: string }>
      })
      .then(data => setClientSecret(data.clientSecret))
      .catch(err => setError(err instanceof Error ? err.message : "Erreur"))
      .finally(() => setLoadingIntent(false))
  }

  useEffect(() => { loadSetupIntent() }, [])

  function handleSuccess() {
    toast.success("Abonnement réactivé !")
    router.replace("/dashboard")
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 -ml-2 text-muted-foreground"
            onClick={() => router.push("/dashboard/abonnement-suspendu")}
          >
            <ArrowLeftIcon className="mr-1.5 size-3.5" />
            Retour
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Se réabonner</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Votre précédent abonnement a été résilié. Choisissez une formule et renseignez un moyen de paiement pour retrouver l&apos;accès.
          </p>
        </div>

        <PlanPicker tier={tier} onTierChange={setTier} plan={plan} onPlanChange={setPlan} pricing={pricing} />

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={loadSetupIntent}>
              <ArrowClockwiseIcon className="mr-1.5 size-3.5" />
              Réessayer
            </Button>
          </div>
        )}

        {loadingIntent && !error && (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-md" />
          </div>
        )}

        {clientSecret && !loadingIntent && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance }}>
            <PaymentForm tier={tier} plan={plan} pricing={pricing} clientSecret={clientSecret} onSuccess={handleSuccess} />
          </Elements>
        )}
      </div>
    </div>
  )
}
