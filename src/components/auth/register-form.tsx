"use client"

import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams, unstable_rethrow } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { registerSchema, type RegisterInput } from "@/lib/schemas"
import type { PricingInfo, PlanTier } from "@/lib/stripe"
import type { OfferPhase } from "@/lib/pricing-offers"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { TERMS_URL, PRIVACY_URL } from "@/lib/consent"
import { GoogleIcon } from "@/components/icons/google-icon"
import { CircleNotchIcon, CheckCircleIcon, LockIcon, ArrowRightIcon, ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { APP_NAME } from "@/config/brand"
import { BASE_PATH } from "@/lib/env"
import { signInWithGoogleDashboard } from "@/lib/auth/actions"
import { stripePromise, stripeAppearance, euros, PlanPicker, type Plan } from "@/components/billing/stripe-elements-shared"

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: "info" | "payment" }) {
  const t = useTranslations("auth.register.steps")
  const steps = [
    { id: "info",    label: t("info")    },
    { id: "payment", label: t("payment") },
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

type Info = { associationName: string; city: string; firstName: string; lastName: string; email: string; password: string; acceptedTerms: true }

function StepInfo({
  defaultValues,
  existingCustomerId,
  viaGoogle,
  pricing,
  hasOffer,
  onNext,
}: {
  defaultValues?:      Partial<Info>
  existingCustomerId?: string
  viaGoogle?:          boolean
  pricing:             PricingInfo
  // A custom-pricing offer link replaces the trial entirely (see /api/register's
  // offerToken branch) — the "X jours gratuits" perk would be misleading here.
  hasOffer?:           boolean
  onNext: (info: Info, customerId: string, clientSecret: string) => void
}) {
  const t = useTranslations("auth.register.form")
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
      if (!res.ok) throw new Error(json.error ?? t("genericError"))
      onNext(
        { associationName: data.associationName, city: data.city ?? "", firstName: data.firstName, lastName: data.lastName, email: data.email, password: data.password, acceptedTerms: data.acceptedTerms },
        json.customerId,
        json.clientSecret,
      )
    } catch (err) {
      setApiError(err instanceof Error ? err.message : t("genericError"))
    } finally {
      setLoading(false)
    }
  }

  const perks = hasOffer
    ? [t("perkNoCommitment"), t("perkEasyCancel")]
    : [t("perkTrialDays", { days: pricing.trialDays }), t("perkNoCommitment"), t("perkEasyCancel")]

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField
        label={t("associationNameLabel")}
        placeholder={t("associationNamePlaceholder")}
        required
        error={errors.associationName?.message}
        {...register("associationName")}
      />

      <FormField
        label={t("cityLabel")}
        placeholder={t("cityPlaceholder")}
        error={errors.city?.message}
        {...register("city")}
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={t("firstNameLabel")}
          placeholder={t("firstNamePlaceholder")}
          autoComplete="given-name"
          required
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <FormField
          label={t("lastNameLabel")}
          placeholder={t("lastNamePlaceholder")}
          autoComplete="family-name"
          required
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>

      <FormField
        label={t("emailLabel")}
        type="email"
        placeholder={t("emailPlaceholder")}
        autoComplete="email"
        required
        error={errors.email?.message}
        {...register("email")}
      />

      <div className="space-y-1.5">
        <FormField
          label={t("passwordLabel")}
          type="password"
          placeholder={t("passwordPlaceholder")}
          autoComplete="new-password"
          required
          error={errors.password?.message}
          {...register("password")}
        />
        {viaGoogle && (
          <p className="text-xs text-muted-foreground">
            {t("passwordGoogleHint")}
          </p>
        )}
      </div>

      <CheckboxField
        id="accepted-terms"
        label={
          <>
            {t("acceptTermsPrefix")}{" "}
            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
              {t("termsOfService")}
            </a>{" "}
            {t("acceptTermsAnd")}{" "}
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
              {t("privacyPolicy")}
            </a>
          </>
        }
        error={errors.acceptedTerms?.message}
        {...register("acceptedTerms")}
      />

      {apiError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{apiError}</p>
      )}

      <Button type="submit" className="w-full h-11 text-sm font-medium mt-2" disabled={loading}>
        {loading
          ? <CircleNotchIcon className="mr-2 size-4 animate-spin" />
          : <ArrowRightIcon    className="mr-2 size-4" />
        }
        {t("continueToPayment")}
      </Button>

      <div className="flex items-center justify-center gap-4 pt-1">
        {perks.map(perk => (
          <span key={perk} className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircleIcon className="size-3 text-emerald-500" />
            {perk}
          </span>
        ))}
      </div>
    </form>
  )
}

// ─── Step 2: payment ──────────────────────────────────────────────────────────

// label is deliberately absent here — it's the staff-only internal note (see
// PricingOffer.label) and the public lookup route never sends it to the browser.
type OfferSummary = { token: string; phases: OfferPhase[] }

function PaymentForm({
  info,
  customerId,
  clientSecret,
  tier,
  plan,
  pricing,
  offer,
  onBack,
  onSuccess,
}: {
  info:         Info
  customerId:   string
  clientSecret: string
  // Standard catalog signup passes tier/plan/pricing; a custom-pricing offer link (see
  // /api/register's offerToken branch) passes `offer` instead — never both.
  tier?:        PlanTier
  plan?:        Plan
  pricing?:     PricingInfo
  offer?:       OfferSummary
  onBack:       () => void
  onSuccess:    () => void
}) {
  const t  = useTranslations("auth.register.payment")
  const tOffer = useTranslations("auth.register.offer")
  const loc = useLocale()
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
        confirmParams: { return_url: window.location.origin + BASE_PATH + "/register" },
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
        if (!setupIntent?.payment_method) throw new Error(t("paymentError"))
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
          acceptedTerms:   info.acceptedTerms,
          customerId,
          paymentMethodId,
          locale: loc,
          ...(offer ? { offerToken: offer.token } : { plan, tier }),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t("createAccountError"))

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("genericError"))
    } finally {
      setLoading(false)
    }
  }

  const tierPricing  = pricing && tier ? pricing.plans[tier] : null
  const monthlyPrice = tierPricing ? euros(tierPricing.monthlyAmountCents) : ""
  const yearlyEquiv  = tierPricing ? euros(Math.round(tierPricing.yearlyAmountCents / 12)) : ""
  const yearlyTotal  = tierPricing ? euros(tierPricing.yearlyAmountCents) : ""
  const discountPct  = tierPricing ? Math.round((1 - (tierPricing.yearlyAmountCents / 12) / tierPricing.monthlyAmountCents) * 100) : 0

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {offer ? (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <span className="text-sm font-medium">{APP_NAME}</span>
          <div className="h-px bg-border" />
          <div className="space-y-1.5 text-sm">
            <div className="text-muted-foreground">{info.associationName}</div>
            {offer.phases.map((phase, i) => (
              <div key={i} className="font-medium text-foreground">
                {phase.months === null
                  ? tOffer("phaseRecurring", { amount: euros(phase.amountCents) })
                  : tOffer("phaseFixed", { amount: euros(phase.amountCents), months: phase.months })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{APP_NAME} · {t("trialBadge")}</span>
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
              {t("freeToday")}
            </span>
          </div>
          <div className="h-px bg-border" />
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{info.associationName}</span>
              <span>{t("trialOffered", { days: pricing!.trialDays })}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{t("afterTrial")}</span>
              <span className="font-medium text-foreground">
                {t("perMonth", { price: plan === "yearly" ? yearlyEquiv : monthlyPrice })}
              </span>
            </div>
            {plan === "yearly" && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="text-amber-600 dark:text-amber-400">{t("billedOnce", { total: yearlyTotal })}</span>
                <span className="text-emerald-600">{t("discount", { pct: discountPct })}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
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
          {offer ? tOffer("confirmButton") : t("startTrial")}
        </Button>
      </div>

      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="size-3" />
        <span>{offer ? tOffer("securePayment") : t("securePayment", { days: pricing!.trialDays })}</span>
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
  const t             = useTranslations("auth.register.done")
  const tOffer         = useTranslations("auth.register.offer")
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const [step,         setStep]         = useState<Step>("info")
  const [tier,         setTier]         = useState<PlanTier>("essential")
  const [plan,         setPlan]         = useState<Plan>("monthly")
  const [info,         setInfo]         = useState<Info | null>(null)
  const [customerId,   setCustomerId]   = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [googlePrefill, setGooglePrefill] = useState<Partial<Info> | null>(null)
  const [googleSigningIn, setGoogleSigningIn] = useState(false)

  // A custom-pricing signup link (?offer=<token>, see /api/register's offerToken branch
  // and src/lib/pricing-offers.ts) replaces the standard Essential/Pro plan picker with a
  // fixed set of phases fetched from the public offer lookup route. offerToken absent =
  // completely unaffected standard flow.
  const offerToken = searchParams.get("offer")
  const [offer,        setOffer]        = useState<OfferSummary | "invalid" | null>(null)
  const [offerLoading, setOfferLoading] = useState(!!offerToken)

  useEffect(() => {
    if (!offerToken) return
    let cancelled = false
    fetch(`/api/public/pricing-offers/${offerToken}`)
      .then(async res => {
        if (cancelled) return
        if (!res.ok) { setOffer("invalid"); return }
        const json = await res.json() as { phases: OfferPhase[] }
        setOffer({ token: offerToken, phases: json.phases })
      })
      .catch(() => { if (!cancelled) setOffer("invalid") })
      .finally(() => { if (!cancelled) setOfferLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Arriving from "Continuer avec Google" on /login (no matching account found there):
  // the name/email come back as query params, get stashed in sessionStorage so they
  // survive a refresh mid-wizard, and the URL is cleaned up immediately. sessionStorage
  // (not localStorage) on purpose — this can carry someone else's name/email, and a
  // shared/public computer shouldn't keep prefilling a stranger's info into /register
  // days later just because the tab/browser was reopened.
  useEffect(() => {
    const gName  = searchParams.get("g_name")
    const gEmail = searchParams.get("g_email")
    if (gName || gEmail) {
      const [firstName, ...rest] = (gName ?? "").trim().split(/\s+/)
      const prefill = { firstName: firstName || "", lastName: rest.join(" "), email: gEmail ?? "" }
      sessionStorage.setItem(GOOGLE_PREFILL_KEY, JSON.stringify(prefill))
      setGooglePrefill(prefill)
      router.replace("/register")
      return
    }
    const stored = sessionStorage.getItem(GOOGLE_PREFILL_KEY)
    if (stored) {
      try { setGooglePrefill(JSON.parse(stored)) } catch { /* ignore malformed value */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (step === "done") sessionStorage.removeItem(GOOGLE_PREFILL_KEY)
  }, [step])

  if (step === "done") {
    // The email field in step 1 is pre-filled from Google but stays editable — only offer
    // the Google CTA if the email actually submitted still matches the Google account's,
    // otherwise signInWithGoogleDashboard() would find no matching user and bounce them
    // straight back to /register right after they just successfully signed up.
    const showGoogleCta = !!(
      googlePrefill?.email && info?.email &&
      googlePrefill.email.trim().toLowerCase() === info.email.trim().toLowerCase()
    )

    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="size-14 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
          <CheckCircleIcon className="size-7 text-emerald-500" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold">{t("title")}</p>
          <p className="text-sm text-muted-foreground">
            {showGoogleCta ? t("withGoogle") : t("withPassword")}
          </p>
        </div>
        {showGoogleCta && (
          <Button
            type="button"
            variant="outline"
            disabled={googleSigningIn}
            onClick={async () => {
              setGoogleSigningIn(true)
              try {
                await signInWithGoogleDashboard()
              } catch (err) {
                unstable_rethrow(err)
                toast.error(t("googleSignInFailed"))
              } finally {
                setGoogleSigningIn(false)
              }
            }}
          >
            {googleSigningIn
              ? <CircleNotchIcon className="mr-2 size-4 animate-spin" />
              : <GoogleIcon className="mr-2 size-4" />
            }
            {t("continueWithGoogle")}
          </Button>
        )}
        {/* Always keep a way to the plain login, even when the Google CTA is shown above —
            it can fail (existing account elsewhere, blocked third-party cookies, etc.) and
            the account does have a password set (see the step-1 hint). */}
        <Link
          href="/login"
          className={cn(
            "text-primary underline underline-offset-4",
            showGoogleCta ? "text-xs text-muted-foreground" : "text-sm"
          )}
        >
          {showGoogleCta ? t("orSignInWithPassword") : t("signIn")}
        </Link>
      </div>
    )
  }

  if (offerLoading) {
    return (
      <div className="flex justify-center py-10">
        <CircleNotchIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (offer === "invalid") {
    return (
      <div className="space-y-3 text-center py-6">
        <p className="font-semibold">{tOffer("invalidTitle")}</p>
        <p className="text-sm text-muted-foreground">{tOffer("invalidBody")}</p>
        <Link href="/login" className="text-sm text-primary underline underline-offset-4">
          {t("signIn")}
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!offer && <PlanPicker tier={tier} onTierChange={setTier} plan={plan} onPlanChange={setPlan} pricing={pricing} />}

      <StepIndicator current={step as "info" | "payment"} />

      {step === "info" && (
        <StepInfo
          // react-hook-form only reads defaultValues once at mount — force a remount once
          // the Google prefill (read from sessionStorage/query params after mount) arrives,
          // otherwise the fields would stay empty despite the prop changing.
          key={info ? "edit" : googlePrefill ? "google-prefill" : "empty"}
          defaultValues={info ?? googlePrefill ?? undefined}
          existingCustomerId={customerId || undefined}
          viaGoogle={!!googlePrefill}
          pricing={pricing}
          hasOffer={!!offer}
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
            tier={offer ? undefined : tier}
            plan={offer ? undefined : plan}
            pricing={offer ? undefined : pricing}
            offer={offer ?? undefined}
            onBack={() => setStep("info")}
            onSuccess={() => setStep("done")}
          />
        </Elements>
      )}
    </div>
  )
}
