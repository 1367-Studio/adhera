import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { z } from "zod"

const schema = z.object({
  email:      z.string().email(),
  name:       z.string().min(1),
  customerId: z.string().optional(),
})

export async function POST(req: Request) {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { email, name, customerId } = parsed.data

  const customer = customerId
    ? await stripe.customers.update(customerId, { email, name })
    : await stripe.customers.create({ email, name })

  const setupIntent = await stripe.setupIntents.create({
    customer:             customer.id,
    payment_method_types: ["card"],
    usage:                "off_session",
  })

  return NextResponse.json({
    clientSecret: setupIntent.client_secret,
    customerId:   customer.id,
  })
}
