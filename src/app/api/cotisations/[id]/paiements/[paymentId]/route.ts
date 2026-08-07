import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { removeCotisationPayment } from "@/lib/cotisation-payments"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const DELETE = withAdminAuth<{ id: string; paymentId: string }>(async (_req, ctx, { id, paymentId }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.cotisation.findFirst({ where: { id, associationId, membre: { deletedAt: null } } })
  if (!existing) return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 })

  const payment = await prisma.cotisationPayment.findFirst({ where: { id: paymentId, cotisationId: id } })
  if (!payment) return NextResponse.json({ error: "Paiement introuvable" }, { status: 404 })

  try {
    const updated = await prisma.$transaction((tx) => removeCotisationPayment(tx, id, paymentId))

    await writeActivityLog({
      associationId, actorId: userId, action: "COTISATION_PAYMENT_REMOVED", entity: "Cotisation", entityId: id,
      label: `${updated.membre.firstName} ${updated.membre.lastName} — ${updated.year}`,
      metadata: { amount: Number(payment.amount), method: payment.method },
    })

    return NextResponse.json(updated)
  } catch (err) {
    // P2025 = record already gone — two tabs / a double-click racing the delete past the
    // findFirst check above. Not an error worth a 500 for; the payment is gone either way.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Ce paiement a déjà été supprimé" }, { status: 404 })
    }
    throw err
  }
}, { roles: FINANCE, module: "cotisations" })
