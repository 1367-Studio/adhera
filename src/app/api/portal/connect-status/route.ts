import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { associationId?: string | null }

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ enabled: false })

  const assoc = await prisma.association.findUnique({
    where:  { id: u.associationId },
    select: { stripeConnectId: true },
  })
  if (!assoc?.stripeConnectId) return NextResponse.json({ enabled: false })

  const account = await stripe.accounts.retrieve(assoc.stripeConnectId)

  return NextResponse.json({ enabled: account.charges_enabled === true })
}
