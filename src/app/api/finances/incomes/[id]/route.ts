import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { incomeUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.income.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Recette introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = incomeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, categoryId, memberId, paymentMethod, description, reference, ...rest } = parsed.data

  // Auto-created from a Facture payment — amount/date/status/reference mirror that
  // payment and can only change by editing it from Factures. categoryId/memberId/
  // paymentMethod/description are association-side annotations and stay editable here.
  if (existing.facturePaymentId) {
    const changesAmount    = rest.amount !== undefined && Number(rest.amount) !== Number(existing.amount)
    const changesStatus    = rest.status !== undefined && rest.status !== existing.status
    const changesDate      = date        !== undefined && new Date(date).getTime() !== existing.date.getTime()
    const changesReference = reference   !== undefined && (reference || null) !== existing.reference
    if (changesAmount || changesStatus || changesDate || changesReference) {
      return NextResponse.json({ error: "Le montant, la date, le statut et la référence de cette recette viennent d'une facture — modifiez-les depuis Factures." }, { status: 409 })
    }
  }

  // If status moves away from PAID, any bank reconciliation for this income is no longer
  // valid — unlink it and reset the transaction, mirroring what DELETE already does.
  const leavesPaid = rest.status !== undefined && rest.status !== "PAID" && existing.status === "PAID"
  const reconciliations = leavesPaid
    ? await prisma.bankReconciliation.findMany({ where: { incomeId: id }, select: { bankTransactionId: true } })
    : []
  const txIds = reconciliations.map(r => r.bankTransactionId)

  const [income] = await prisma.$transaction([
    prisma.income.update({
      where: { id },
      data:  {
        ...rest,
        ...(date          ? { date: new Date(date) } : {}),
        ...(categoryId    !== undefined ? { categoryId:    categoryId    || null } : {}),
        ...(memberId      !== undefined ? { memberId:      memberId      || null } : {}),
        ...(paymentMethod !== undefined ? { paymentMethod: paymentMethod || null } : {}),
        ...(description   !== undefined ? { description:   description   || null } : {}),
        ...(reference     !== undefined ? { reference:     reference     || null } : {}),
      },
    }),
    ...(leavesPaid ? [prisma.bankReconciliation.deleteMany({ where: { incomeId: id } })] : []),
    ...(txIds.length > 0
      ? [prisma.bankTransaction.updateMany({ where: { id: { in: txIds } }, data: { status: "UNMATCHED" as const } })]
      : []),
  ])

  await writeActivityLog({ associationId, actorId: userId, action: "INCOME_UPDATED", entity: "Income", entityId: id })
  return NextResponse.json(income)
}, { roles: FINANCE, module: "finances" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.income.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Recette introuvable" }, { status: 404 })
  if (existing.facturePaymentId) {
    return NextResponse.json({ error: "Cette recette vient d'une facture — supprimez plutôt le paiement depuis Factures." }, { status: 409 })
  }

  // Find linked bank transactions before deleting the reconciliation link
  const reconciliations = await prisma.bankReconciliation.findMany({
    where: { incomeId: id },
    select: { bankTransactionId: true },
  })
  const txIds = reconciliations.map(r => r.bankTransactionId)

  await prisma.$transaction([
    prisma.bankReconciliation.deleteMany({ where: { incomeId: id } }),
    // Reset orphaned transactions back to UNMATCHED so they can be re-reconciled
    ...(txIds.length > 0
      ? [prisma.bankTransaction.updateMany({ where: { id: { in: txIds } }, data: { status: "UNMATCHED" } })]
      : []),
    prisma.income.delete({ where: { id } }),
  ])

  await writeActivityLog({ associationId, actorId: userId, action: "INCOME_DELETED", entity: "Income", entityId: id })
  return new NextResponse(null, { status: 204 })
}, { roles: FINANCE, module: "finances" })
