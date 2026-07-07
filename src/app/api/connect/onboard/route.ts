import { NextResponse } from "next/server"
import { stripe, isStaleStripeResourceError } from "@/lib/stripe"
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

  const originalConnectId = assoc.stripeConnectId
  let connectId = originalConnectId
  let detailsSubmitted = false

  if (connectId) {
    // Un compte peut déjà avoir un ID enregistré sans avoir terminé l'onboarding
    // (ex : abandon en cours de route) — Stripe refuse un lien "account_update"
    // tant que l'onboarding initial n'est pas complet.
    try {
      const account = await stripe.accounts.retrieve(connectId)
      detailsSubmitted = account.details_submitted
    } catch (err) {
      if (!isStaleStripeResourceError(err)) throw err
      // L'ID enregistré ne correspond plus à un compte accessible (supprimé,
      // accès révoqué...) — on repart de zéro plutôt que de planter la route.
      console.error("[stripe-connect] stale/inaccessible account for association", associationId, err)
      connectId = null
    }
  }

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
      // Compare-and-swap sur la valeur lue en tout début de requête : si un autre
      // clic concurrent a déjà écrit un stripeConnectId entre-temps, on abandonne
      // le compte qu'on vient de créer plutôt que d'écraser le sien.
      const { count } = await prisma.association.updateMany({
        where: { id: associationId, stripeConnectId: originalConnectId },
        data:  { stripeConnectId: connectId },
      })
      if (count === 0) {
        await stripe.accounts.del(connectId).catch(() => null)
        const fresh = await prisma.association.findUnique({
          where:  { id: associationId },
          select: { stripeConnectId: true },
        })
        connectId = fresh!.stripeConnectId!
        const account2 = await stripe.accounts.retrieve(connectId)
        detailsSubmitted = account2.details_submitted
      }
    } catch (err) {
      await stripe.accounts.del(account.id).catch(() => null)
      throw err
    }
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
