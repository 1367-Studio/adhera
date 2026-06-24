import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { APP_URL } from "@/lib/env"

const ADMINS = ["ADMIN", "PRESIDENT"]

export async function POST() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!ADMINS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { stripeConnectId: true, name: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  let connectId = assoc.stripeConnectId

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
  }

  const linkType = assoc.stripeConnectId ? "account_update" : "account_onboarding"

  const accountLink = await stripe.accountLinks.create({
    account:     connectId,
    type:        linkType,
    return_url:  `${APP_URL}/dashboard/parametres?connect=success`,
    refresh_url: `${APP_URL}/dashboard/parametres?connect=refresh`,
  })

  return NextResponse.json({ url: accountLink.url })
}
