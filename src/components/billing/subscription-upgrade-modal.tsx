"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import type { PlanPricing } from "@/lib/stripe"
import { stripePromise, stripeAppearance, stripeFonts, euros, type Plan } from "@/components/billing/stripe-elements-shared"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CircleNotchIcon, LockIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { apiErrorMessage } from "@/lib/api-error"
import { BASE_PATH } from "@/lib/env"

// How many months' worth of the monthly price the annual price waives, rounded to the
// nearest whole month — mirrors annualMonthsFree() in stripe-elements-shared.tsx, but
// scoped to a single tier (this modal never offers a tier choice, only a cycle choice).
function monthsFree(monthlyAmountCents: number, yearlyAmountCents: number): number {
  if (monthlyAmountCents === 0) return 0
  return Math.round((monthlyAmountCents * 12 - yearlyAmountCents) / monthlyAmountCents)
}

function CycleChoice({ plan, onPlanChange, pricing }: {
  plan: Plan; onPlanChange: (p: Plan) => void; pricing: PlanPricing
}) {
  const freeMonths = monthsFree(pricing.monthlyAmountCents, pricing.yearlyAmountCents)

  const options: { id: Plan; title: string; body: string }[] = [
    {
      id:    "monthly",
      title: "Abonnement mensuel",
      body:  "Paiement mensuel récurrent, selon le tarif de la formule choisie.",
    },
    {
      id:    "yearly",
      title: "Abonnement annuel",
      body:  freeMonths > 0
        ? `Bénéficiez de ${freeMonths} mois offerts en choisissant le paiement annuel : vous ne payez que ${12 - freeMonths} mois pour 12 mois de service.`
        : "Un seul paiement pour les 12 mois de service.",
    },
  ]

  return (
    <div className="space-y-2.5">
      {options.map((opt, i) => {
        const price = opt.id === "yearly" ? euros(pricing.yearlyAmountCents) : euros(pricing.monthlyAmountCents)
        const selected = plan === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onPlanChange(opt.id)}
            className={cn(
              "w-full rounded-lg border p-3.5 text-left transition-colors",
              selected ? "border-foreground bg-foreground/5 ring-1 ring-foreground" : "border-border hover:border-muted-foreground/40"
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">Option {i + 1} — {opt.title}</p>
              <p className="whitespace-nowrap text-sm font-bold">
                {price}<span className="text-xs font-normal text-muted-foreground">{opt.id === "yearly" ? "/an" : "/mois"}</span>
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{opt.body}</p>
          </button>
        )
      })}
    </div>
  )
}

function PaymentForm({ cycle, onSuccess, onCancel }: { cycle: Plan; onSuccess: () => void; onCancel: () => void }) {
  const stripe   = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setError("")
    setLoading(true)

    try {
      const { error: stripeErr, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect:      "if_required",
        confirmParams: { return_url: window.location.origin + BASE_PATH + "/dashboard" },
      })
      if (stripeErr || !setupIntent?.payment_method) {
        throw new Error(stripeErr?.message ?? "Le paiement n'a pas pu être confirmé.")
      }

      const res = await fetch("/api/billing/upgrade-from-offer", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ paymentMethodId: setupIntent.payment_method, cycle }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la confirmation du paiement."))

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <PaymentElement
          options={{
            layout:        { type: "tabs", defaultCollapsed: false },
            defaultValues: { billingDetails: { address: { country: "FR" } } },
          }}
        />
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
          Retour
        </Button>
        <Button type="submit" className="flex-1" disabled={loading || !stripe}>
          {loading && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
          Confirmer et payer
        </Button>
      </div>

      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="size-3" />
        <span>Paiement sécurisé par Stripe</span>
      </div>
    </form>
  )
}

// The cycle picker + in-place Stripe checkout, shared between SubscriptionUpgradeModal
// (shown pre-emptively, from inside the dashboard, while the grace period hasn't expired
// yet) and SuspendedSubscriptionView (shown after it has, once access is already locked —
// see that component for why reactivation can't just send her to the Stripe billing
// portal like a normal payment-failure suspension: a 0€ subscription has no invoice to
// retry there). Owns no Modal/Card chrome of its own so either caller can wrap it.
export function SubscriptionUpgradeCheckout({ essentialPricing, onSuccess }: {
  essentialPricing: PlanPricing
  onSuccess:        () => void
}) {
  const [plan, setPlan] = useState<Plan>("monthly")
  const [clientSecret, setClientSecret] = useState("")
  const [loadingIntent, setLoadingIntent] = useState(false)
  const [error, setError] = useState("")

  function startCheckout() {
    setLoadingIntent(true)
    setError("")
    fetch("/api/billing/upgrade-from-offer/setup-intent", { method: "POST" })
      .then(async res => {
        if (!res.ok) throw new Error(await apiErrorMessage(res, "Une erreur est survenue."))
        return res.json() as Promise<{ clientSecret: string }>
      })
      .then(data => setClientSecret(data.clientSecret))
      .catch(err => setError(err instanceof Error ? err.message : "Une erreur est survenue."))
      .finally(() => setLoadingIntent(false))
  }

  return (
    <div className="space-y-5">
      {!clientSecret && (
        <>
          <CycleChoice plan={plan} onPlanChange={setPlan} pricing={essentialPricing} />

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

          <Button className="w-full" size="lg" onClick={startCheckout} disabled={loadingIntent}>
            {loadingIntent && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
            CHOISIR NOTRE FORMULE
          </Button>
        </>
      )}

      {loadingIntent && !clientSecret && (
        <Skeleton className="h-32 w-full rounded-lg" />
      )}

      {clientSecret && (
        <Elements stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance, fonts: stripeFonts }}>
          <PaymentForm cycle={plan} onSuccess={onSuccess} onCancel={() => setClientSecret("")} />
        </Elements>
      )}
    </div>
  )
}

export function SubscriptionUpgradeModal({ show, essentialPricing, overdue }: {
  show: boolean
  essentialPricing: PlanPricing
  // The staff-set deadline (subscriptionGracePeriodEndsAt) has already passed but the
  // daily sweep cron hasn't suspended her yet — see dashboard/layout.tsx's comment on
  // gracePeriodOverdue. Same modal, just swaps the "upcoming deadline" copy for an
  // "already overdue" one instead of silently keeping the stale pre-deadline wording.
  overdue: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(show)

  function handleSuccess() {
    setOpen(false)
    toast.success("Votre abonnement Formwise est maintenant actif.")
    router.refresh()
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      locked
      size="lg"
      title="Votre abonnement Formwise"
      description={overdue
        ? "Le délai accordé pour souscrire à un abonnement payant est dépassé. Choisissez une formule ci-dessous pour éviter la suspension de l'accès à Formwise."
        : "À compter du 1er novembre, l'association doit souscrire à un abonnement payant pour continuer à utiliser Formwise. Choisissez la formule la plus adaptée aux besoins de l'association."}
    >
      <SubscriptionUpgradeCheckout essentialPricing={essentialPricing} onSuccess={handleSuccess} />
    </Modal>
  )
}
