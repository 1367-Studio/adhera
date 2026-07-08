"use client"

import { loadStripe } from "@stripe/stripe-js"
import type { PricingInfo } from "@/lib/stripe"
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

export function PlanSelector({ plan, onChange, pricing }: { plan: Plan; onChange: (p: Plan) => void; pricing: PricingInfo }) {
  const monthlyPrice = euros(pricing.monthlyAmountCents)
  const yearlyEquiv  = euros(Math.round(pricing.yearlyAmountCents / 12))
  const yearlyTotal  = euros(pricing.yearlyAmountCents)
  const discountPct  = Math.round((1 - (pricing.yearlyAmountCents / 12) / pricing.monthlyAmountCents) * 100)

  const options = [
    { id: "monthly" as Plan, label: "Mensuel", price: monthlyPrice, note: null, billingNote: "Prélevé chaque mois" },
    { id: "yearly"  as Plan, label: "Annuel",  price: yearlyEquiv,  note: `−${discountPct} %`, billingNote: `Facturé ${yearlyTotal} en une fois /an` },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "relative rounded-xl border p-4 text-left transition-all",
            plan === opt.id
              ? "border-foreground bg-foreground/5 ring-1 ring-foreground"
              : "border-border hover:border-muted-foreground/40"
          )}
        >
          {opt.note && (
            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap">
              {opt.note}
            </span>
          )}
          <p className="text-xs font-medium text-muted-foreground">{opt.label}</p>
          <p className="mt-1 text-xl font-bold">
            {opt.price}
            <span className="text-xs font-normal text-muted-foreground">/mois</span>
          </p>
          {/* Disclosed here, on the plan-choice step, not only on the payment step below —
              the annual plan isn't a cheaper monthly draft, it's a single yearly charge. */}
          <p className="mt-1 text-[11px] text-muted-foreground">{opt.billingNote}</p>
        </button>
      ))}
    </div>
  )
}
