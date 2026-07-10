"use client"

import { loadStripe } from "@stripe/stripe-js"
import type { PricingInfo, PlanTier } from "@/lib/stripe"
import { cn } from "@/lib/utils"

export const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export const stripeAppearance = {
  theme:     "flat" as const,
  variables: {
    colorPrimary:    "#000000",
    colorBackground: "#ffffff",
    colorText:       "#111318",
    colorDanger:     "#ef4444",
    fontFamily:      "inherit",
    borderRadius:    "8px",
    spacingUnit:     "4px",
    fontSizeBase:    "14px",
  },
  rules: {
    ".Input": {
      border:          "1px solid #e5e7eb",
      boxShadow:       "none",
      padding:         "10px 12px",
      backgroundColor: "#ffffff",
    },
    ".Input:focus": {
      border:    "1px solid #000000",
      boxShadow: "0 0 0 3px rgba(0,0,0,0.08)",
      outline:   "none",
    },
    ".Label": {
      fontSize:     "12px",
      fontWeight:   "500",
      color:        "#374151",
      marginBottom: "6px",
    },
  },
}

// Single formatting helper for every euro amount shown across billing flows — all of
// them derive from a PricingInfo fetched live from Stripe, never from a separately
// typed string.
export function euros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

export type Plan = "monthly" | "yearly"

// How many months' worth of the monthly price the annual price waives, rounded to the
// nearest whole month — derived from the live Stripe amounts instead of a hardcoded "−2
// mois" claim that would silently go stale the moment either price changes unevenly.
function annualMonthsFree(p: { monthlyAmountCents: number; yearlyAmountCents: number }): number {
  if (p.monthlyAmountCents === 0) return 0
  return Math.round((p.monthlyAmountCents * 12 - p.yearlyAmountCents) / p.monthlyAmountCents)
}

// Combines tier (Essentiel/Pro) and billing cycle (monthly/yearly) into one compact
// control instead of two stacked grids — a shared cycle toggle up top (same pattern as
// form-wise-app's landing-page BillingSelector) drives the price shown on 2 tier cards
// below, so picking one of the 4 (tier × cycle) combinations only ever takes 2 taps.
export function PlanPicker({
  tier, onTierChange,
  plan, onPlanChange,
  pricing,
}: {
  tier: PlanTier; onTierChange: (t: PlanTier) => void
  plan: Plan; onPlanChange: (p: Plan) => void
  pricing: PricingInfo
}) {
  // Essentiel and Pro discount the annual price by the same number of months today, but
  // nothing guarantees that stays true — only show the specific "−N mois" claim on the
  // shared toggle when it's actually accurate for both, otherwise fall back to a plain
  // label rather than overstate one tier's discount.
  const essentialMonthsFree = annualMonthsFree(pricing.plans.essential)
  const proMonthsFree       = annualMonthsFree(pricing.plans.pro)
  const annualBadge = essentialMonthsFree > 0 && essentialMonthsFree === proMonthsFree
    ? `−${essentialMonthsFree} mois`
    : null

  const cycles: { id: Plan; label: string }[] = [
    { id: "monthly", label: "Mensuel" },
    { id: "yearly",  label: "Annuel" },
  ]

  const tiers: { id: PlanTier; label: string; limit: number; highlighted?: boolean }[] = [
    { id: "essential", label: "Essentiel", limit: pricing.plans.essential.memberLimit },
    { id: "pro",       label: "Pro",       limit: pricing.plans.pro.memberLimit, highlighted: true },
  ]

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Cycle de facturation" className="mx-auto flex w-fit items-center gap-1 rounded-full border bg-muted/50 p-1">
        {cycles.map(c => (
          <button
            key={c.id}
            type="button"
            aria-pressed={plan === c.id}
            onClick={() => onPlanChange(c.id)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              plan === c.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {c.label}
            {c.id === "yearly" && annualBadge && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{annualBadge}</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {tiers.map(t => {
          const tierPricing = pricing.plans[t.id]
          const price = plan === "yearly"
            ? euros(Math.round(tierPricing.yearlyAmountCents / 12))
            : euros(tierPricing.monthlyAmountCents)
          const selected = tier === t.id

          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTierChange(t.id)}
              className={cn(
                "relative rounded-xl border p-4 text-left transition-all",
                selected
                  ? "border-foreground bg-foreground/5 ring-1 ring-foreground"
                  : "border-border hover:border-muted-foreground/40"
              )}
            >
              {t.highlighted && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background whitespace-nowrap">
                  Populaire
                </span>
              )}
              <p className="text-sm font-semibold">{t.label}</p>
              <p className="mt-1 text-xl font-bold tracking-tight">
                {price}
                <span className="text-xs font-normal text-muted-foreground">/mois</span>
              </p>
              {/* Disclosed here, not only on the payment step below — the annual plan isn't
                  a cheaper monthly draft, it's a single yearly charge. */}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {plan === "yearly" ? `Facturé ${euros(tierPricing.yearlyAmountCents)}/an` : "Prélevé chaque mois"}
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Jusqu&apos;à {t.limit} membres</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
