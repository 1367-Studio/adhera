import Stripe from "stripe"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-05-27.dahlia" as never,
})

export const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY!
export const STRIPE_PRICE_YEARLY  = process.env.STRIPE_PRICE_YEARLY!
export const TRIAL_DAYS           = 20
