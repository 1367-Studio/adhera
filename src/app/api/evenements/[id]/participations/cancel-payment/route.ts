import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Reverses a cash ("espèces") ticket payment recorded via the mark-paid action — the only
// way to unstick one, since the guest-removal endpoint refuses to delete a paid participation
// and the portal's cancel-ticket flow only handles Stripe-paid tickets.
export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { participationId, membreId } = await req.json() as { participationId?: string; membreId?: string }

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId }, select: { title: true } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const participation = participationId
    ? await prisma.participation.findFirst({ where: { id: participationId, evenementId } })
    : membreId
      ? await prisma.participation.findFirst({ where: { membreId, evenementId } })
      : null
  if (!participation) return NextResponse.json({ error: "Participation introuvable" }, { status: 404 })

  if (!participation.ticketPaidAt)
    return NextResponse.json({ error: "Ce billet n'est pas marqué comme payé" }, { status: 422 })
  if (participation.stripeSessionId)
    return NextResponse.json({ error: "Ce billet a été payé par carte — annulez-le depuis le paiement Stripe" }, { status: 422 })

  const paidIncomes = await prisma.income.findMany({
    where:  { participationId: participation.id, status: "PAID" },
    select: { id: true },
  })
  // Find linked bank transactions before deleting the reconciliation link — otherwise a
  // transaction reconciled against this income is left pointing at nothing, stuck at
  // MATCHED forever.
  const reconciliations = paidIncomes.length
    ? await prisma.bankReconciliation.findMany({
        where:  { incomeId: { in: paidIncomes.map(i => i.id) } },
        select: { bankTransactionId: true },
      })
    : []
  const txIds = reconciliations.map(r => r.bankTransactionId)

  await prisma.$transaction([
    prisma.bankReconciliation.deleteMany({ where: { incomeId: { in: paidIncomes.map(i => i.id) } } }),
    ...(txIds.length > 0
      ? [prisma.bankTransaction.updateMany({ where: { id: { in: txIds } }, data: { status: "UNMATCHED" } })]
      : []),
    prisma.income.deleteMany({ where: { id: { in: paidIncomes.map(i => i.id) } } }),
    prisma.participation.update({
      where: { id: participation.id },
      data:  { ticketPaidAt: null, amount: null },
    }),
  ])

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "TICKET_PAYMENT_CANCELLED",
    entity:   "Participation",
    entityId: participation.id,
    label:    evenement.title,
    metadata: { memberName: `${participation.firstName} ${participation.lastName}` },
  })

  return NextResponse.json({ ok: true })
})
