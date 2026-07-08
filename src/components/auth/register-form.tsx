"use client"

import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { registerSchema, type RegisterInput } from "@/lib/schemas"
import type { PricingInfo } from "@/lib/stripe"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { CircleNotchIcon, CheckCircleIcon, LockIcon, ArrowRightIcon, ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { APP_NAME } from "@/config/brand"
import { stripePromise, stripeAppearance, euros, PlanSelector, type Plan } from "@/components/billing/stripe-elements-shared"

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: "info" | "payment" }) {
  const steps = [
    { id: "info",    label: "Votre compte" },
    { id: "payment", label: "Paiement"     },
  ]
  return (
    <div className="flex items-center justify-center gap-0">
      {steps.map((step, i) => {
        const done   = current === "payment" && step.id === "info"
        const active = current === step.id
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={cn(
                "size-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all",
                done   ? "bg-foreground text-background" :
                active ? "bg-primary text-primary-foreground" :
                         "bg-muted text-muted-foreground"
              )}>
                {done ? <CheckCircleIcon className="size-3.5" /> : i + 1}
              </div>
              <span className={cn(
                "text-sm transition-colors",
                active ? "font-medium text-foreground" : "text-muted-foreground"
              )}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("mx-4 h-px w-12 transition-colors", done ? "bg-foreground" : "bg-border")} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: info ─────────────────────────────────────────────────────────────

type Info = { associationName: string; city: string; firstName: string; lastName: string; email: string; password: string }

function StepInfo({
  defaultValues,
  existingCustomerId,
  pricing,
  onNext,
}: {
  defaultValues?:      Partial<Info>
  existingCustomerId?: string
  pricing:             PricingInfo
  onNext: (info: Info, customerId: string, clientSecret: string) => void
}) {
  const [loading,  setLoading]  = useState(false)
  const [apiError, setApiError] = useState("")

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterInput>({
    resolver:      zodResolver(registerSchema),
    mode:          "onSubmit",
    defaultValues: defaultValues as RegisterInput | undefined,
  })

  async function onSubmit(data: RegisterInput) {
    setApiError("")
    setLoading(true)
    try {
      const res  = await fetch("/api/stripe/setup-intent", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:       `${data.firstName} ${data.lastName}`,
          email:      data.email,
          customerId: existingCustomerId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Erreur")
      onNext(
        { associationName: data.associationName, city: data.city ?? "", firstName: data.firstName, lastName: data.lastName, email: data.email, password: data.password },
        json.customerId,
        json.clientSecret,
      )
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Erreur")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField
        label="Nom de l'association"
        placeholder="Association Sportive de Paris"
        required
        error={errors.associationName?.message}
        {...register("associationName")}
      />

      <FormField
        label="Ville"
        placeholder="Paris"
        error={errors.city?.message}
        {...register("city")}
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Prénom"
          placeholder="Jean"
          autoComplete="given-name"
          required
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <FormField
          label="Nom"
          placeholder="Dupont"
          autoComplete="family-name"
          required
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>

      <FormField
        label="Adresse email"
        type="email"
        placeholder="contact@association.fr"
        autoComplete="email"
        required
        error={errors.email?.message}
        {...register("email")}
      />

      <FormField
        label="Mot de passe"
        type="password"
        placeholder="Min. 8 caractères"
        autoComplete="new-password"
        required
        error={errors.password?.message}
        {...register("password")}
      />

      {apiError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{apiError}</p>
      )}

      <Button type="submit" className="w-full h-11 text-sm font-medium mt-2" disabled={loading}>
        {loading
          ? <CircleNotchIcon className="mr-2 size-4 animate-spin" />
          : <ArrowRightIcon    className="mr-2 size-4" />
        }
        Continuer vers le paiement
      </Button>

      <div className="flex items-center justify-center gap-4 pt-1">
        {[`${pricing.trialDays} jours gratuits`, "Sans engagement", "Annulation facile"].map(t => (
          <span key={t} className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircleIcon className="size-3 text-emerald-500" />
            {t}
          </span>
        ))}
      </div>
    </form>
  )
}

// ─── Step 2: payment ──────────────────────────────────────────────────────────

function PaymentForm({
  info,
  customerId,
  clientSecret,
  plan,
  pricing,
  onBack,
  onSuccess,
}: {
  info:         Info
  customerId:   string
  clientSecret: string
  plan:         Plan
  pricing:      PricingInfo
  onBack:       () => void
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
        confirmParams: { return_url: window.location.origin + "/register" },
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

      const res = await fetch("/api/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          associationName: info.associationName,
          city:            info.city || undefined,
          firstName:       info.firstName,
          lastName:        info.lastName,
          email:           info.email,
          password:        info.password,
          customerId,
          paymentMethodId,
          plan,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de la création du compte")

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur")
    } finally {
      setLoading(false)
    }
  }

  const monthlyPrice = euros(pricing.monthlyAmountCents)
  const yearlyEquiv  = euros(Math.round(pricing.yearlyAmountCents / 12))
  const yearlyTotal  = euros(pricing.yearlyAmountCents)
  const discountPct  = Math.round((1 - (pricing.yearlyAmountCents / 12) / pricing.monthlyAmountCents) * 100)

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{APP_NAME} · Essai gratuit</span>
          <span className="text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
            0 € aujourd&apos;hui
          </span>
        </div>
        <div className="h-px bg-border" />
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>{info.associationName}</span>
            <span>{pricing.trialDays} jours offerts</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Après la période d&apos;essai</span>
            <span className="font-medium text-foreground">
              {plan === "yearly" ? `${yearlyEquiv}/mois` : `${monthlyPrice}/mois`}
            </span>
          </div>
          {plan === "yearly" && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="text-amber-600 dark:text-amber-400">Facturé en une fois · {yearlyTotal}/an</span>
              <span className="text-emerald-600">−{discountPct} %</span>
            </div>
          )}
        </div>
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

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 px-4" onClick={onBack} disabled={loading}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Button type="submit" className="flex-1 h-11 text-sm font-medium" disabled={loading || !stripe}>
          {loading && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
          Démarrer mon essai gratuit
        </Button>
      </div>

      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="size-3" />
        <span>Paiement sécurisé par Stripe · Annulez avant {pricing.trialDays} jours pour ne rien payer</span>
      </div>
    </form>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Step = "info" | "payment" | "done"

const GOOGLE_PREFILL_KEY = "adhera-google-prefill"

export function RegisterForm({ pricing }: { pricing: PricingInfo }) {
  return (
    <Suspense fallback={null}>
      <RegisterFormInner pricing={pricing} />
    </Suspense>
  )
}

// useSearchParams() (for the Google prefill) requires a Suspense boundary above it, or
// `next build` fails prerendering this page — the wrapper above provides that.
function RegisterFormInner({ pricing }: { pricing: PricingInfo }) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [step,         setStep]         = useState<Step>("info")
  const [plan,         setPlan]         = useState<Plan>("monthly")
  const [info,         setInfo]         = useState<Info | null>(null)
  const [customerId,   setCustomerId]   = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [googlePrefill, setGooglePrefill] = useState<Partial<Info> | null>(null)

  // Arriving from "Continuer avec Google" on /login (no matching account found there):
  // the name/email come back as query params, get stashed in localStorage so they survive
  // a refresh mid-wizard, and the URL is cleaned up immediately.
  useEffect(() => {
    const gName  = searchParams.get("g_name")
    const gEmail = searchParams.get("g_email")
    if (gName || gEmail) {
      const [firstName, ...rest] = (gName ?? "").trim().split(/\s+/)
      const prefill = { firstName: firstName || "", lastName: rest.join(" "), email: gEmail ?? "" }
      localStorage.setItem(GOOGLE_PREFILL_KEY, JSON.stringify(prefill))
      setGooglePrefill(prefill)
      router.replace("/register")
      return
    }
    const stored = localStorage.getItem(GOOGLE_PREFILL_KEY)
    if (stored) {
      try { setGooglePrefill(JSON.parse(stored)) } catch { /* ignore malformed value */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (step === "done") localStorage.removeItem(GOOGLE_PREFILL_KEY)
  }, [step])

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="size-14 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
          <CheckCircleIcon className="size-7 text-emerald-500" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold">Compte créé avec succès !</p>
          <p className="text-sm text-muted-foreground">Vos identifiants vous ont été envoyés par email.</p>
        </div>
        <Link href="/login" className="text-sm text-primary underline underline-offset-4">
          Se connecter
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PlanSelector plan={plan} onChange={setPlan} pricing={pricing} />

      <StepIndicator current={step as "info" | "payment"} />

      {step === "info" && (
        <StepInfo
          // react-hook-form only reads defaultValues once at mount — force a remount once
          // the Google prefill (read from localStorage/query params after mount) arrives,
          // otherwise the fields would stay empty despite the prop changing.
          key={info ? "edit" : googlePrefill ? "google-prefill" : "empty"}
          defaultValues={info ?? googlePrefill ?? undefined}
          existingCustomerId={customerId || undefined}
          pricing={pricing}
          onNext={(i, cid, cs) => {
            setInfo(i)
            setCustomerId(cid)
            setClientSecret(cs)
            setStep("payment")
          }}
        />
      )}

      {step === "payment" && info && clientSecret && (
        <Elements stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance }}>
          <PaymentForm
            info={info}
            customerId={customerId}
            clientSecret={clientSecret}
            plan={plan}
            pricing={pricing}
            onBack={() => setStep("info")}
            onSuccess={() => setStep("done")}
          />
        </Elements>
      )}
    </div>
  )
}
