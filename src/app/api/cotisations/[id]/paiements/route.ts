import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { cotisationPaymentSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { recordCotisationPayment, sendCotisationPaymentConfirmation, CotisationOverpaymentError } from "@/lib/cotisation-payments"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.cotisation.findFirst({ where: { id, associationId, membre: { deletedAt: null } } })
  if (!existing) return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 })
  if (existing.status === "EXONERE") {
    return NextResponse.json({ error: "Cette cotisation est exonérée" }, { status: 409 })
  }

  const body   = await req.json()
  const parsed = cotisationPaymentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { amount, method, paidAt, note } = parsed.data

  try {
    const cotisation = await prisma.$transaction((tx) => recordCotisationPayment(tx, {
      associationId,
      cotisationId: id,
      amount,
      method,
      paidAt: paidAt ? new Date(paidAt) : undefined,
      note,
    }))

    await writeActivityLog({
      associationId, actorId: userId, action: "COTISATION_PAYMENT_ADDED", entity: "Cotisation", entityId: id,
      label: `${cotisation.membre.firstName} ${cotisation.membre.lastName} — ${cotisation.year}`,
      metadata: { amount, method },
    })

    await sendCotisationPaymentConfirmation(cotisation, amount)

    return NextResponse.json(cotisation, { status: 201 })
  } catch (err) {
    if (err instanceof CotisationOverpaymentError) {
      return NextResponse.json({ error: `Le montant dépasse le solde restant (${err.remaining.toFixed(2)} €)` }, { status: 422 })
    }
    throw err
  }
}, { roles: FINANCE, module: "cotisations" })
