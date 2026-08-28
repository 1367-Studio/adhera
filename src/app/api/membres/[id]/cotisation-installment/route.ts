import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { cancelActiveInstallmentPlanForMembre } from "@/lib/webhook/membership-installments"

// Same role set as the cotisation-subscription cancel route — stopping a recurring payment
// is a finance call, not a general membre-management one.
const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const membre = await prisma.membre.findFirst({
    where:  { id, associationId, deletedAt: null },
    select: { firstName: true, lastName: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const cancelled = await cancelActiveInstallmentPlanForMembre(id, {
    actorId: userId,
    label:   `${membre.firstName} ${membre.lastName}`,
  })
  if (!cancelled) {
    return NextResponse.json({ error: "Aucun paiement en plusieurs fois actif à arrêter, ou l'arrêt a échoué." }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}, { roles: FINANCE })
