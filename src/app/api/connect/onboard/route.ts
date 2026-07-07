import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMINS = ["ADMIN", "PRESIDENT"]

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, role } = ctx

  if (!ADMINS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { stripeConnectId: true, name: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  let connectId = assoc.stripeConnectId
  let detailsSubmitted = false

  if (!connectId) {
    const account = await stripe.accounts.create({
      type:          "express",
      country:       "FR",
      business_type: "non_profit",
      capabilities:  {
        card_payments: { requested: true },
        transfers:     { requested: true },
      },
      business_profile: { name: assoc.name },
    })
    connectId = account.id
    try {
      await prisma.association.update({
        where: { id: associationId },
        data:  { stripeConnectId: connectId },
      })
    } catch (err) {
      await stripe.accounts.del(connectId).catch(() => null)
      throw err
    }
  } else {
    // Un compte peut déjà avoir un ID enregistré sans avoir terminé l'onboarding
    // (ex : abandon en cours de route) — Stripe refuse un lien "account_update"
    // tant que l'onboarding initial n'est pas complet.
    const account = await stripe.accounts.retrieve(connectId)
    detailsSubmitted = account.details_submitted
  }

  const linkType = detailsSubmitted ? "account_update" : "account_onboarding"

  const accountLink = await stripe.accountLinks.create({
    account:     connectId,
    type:        linkType,
    return_url:  `${APP_URL}/dashboard/parametres?connect=success`,
    refresh_url: `${APP_URL}/dashboard/parametres?connect=refresh`,
  })

  return NextResponse.json({ url: accountLink.url })
})
