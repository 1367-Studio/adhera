import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"

// Force-suspends an association whose staff-set subscriptionGracePeriodEndsAt deadline
// has passed while it's still on a negotiated 0€ PricingOffer (subscriptionAmountCents
// === 0, see the field's comment in prisma/schema.prisma) — a free subscription never
// naturally fails an invoice, so Stripe's own dunning (which drives this same SUSPENDED
// status in the customer.subscription.updated webhook otherwise) can't be relied on to
// enforce a hard deadline here. Setting subscriptionStatus directly reuses the existing,
// unmodified lock screen (proxy.ts + /dashboard/abonnement-suspendu) — nothing about the
// standby UI needs to change for this.
// Vercel Cron always invokes the configured path with GET, not POST — this must export a
// GET handler or the schedule silently 405s on every tick (POST kept for manual curl testing).
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/subscription-grace-period-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { count: suspended } = await prisma.association.updateMany({
    where: {
      subscriptionGracePeriodEndsAt: { lt: new Date() },
      subscriptionAmountCents:       0,
      subscriptionStatus:            "ACTIVE",
    },
    data: { subscriptionStatus: "SUSPENDED", suspendedAt: new Date() },
  })

  return NextResponse.json({ suspended })
}

export const GET = handler
export const POST = handler
