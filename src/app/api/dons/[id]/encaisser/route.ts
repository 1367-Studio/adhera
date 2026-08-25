import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { generateRecuFiscalForDon } from "@/lib/pdf/recu-fiscal"
import { sendEmail } from "@/lib/mail"
import { donConfirmationEmail } from "@/lib/email"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

// Confirms receipt of an offline donation (espèces/chèque/virement) — the one place
// besides the Stripe webhook that's allowed to write Don.paidAt. Non-negotiable: no
// fiscal receipt number is minted before this fires. It's sequential and legally
// opposable — burning one on a cheque that later bounces isn't something you undo.
export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const don = await prisma.don.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: {
      association: { select: { id: true, name: true, address: true, city: true, siren: true, rna: true, canIssueTaxReceipts: true, objet: true, organismeCategory: true, organismeCategoryDetail: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
    },
  })
  if (!don) return NextResponse.json({ error: "Don introuvable" }, { status: 404 })
  if (don.paidAt) return NextResponse.json({ error: "Ce don est déjà encaissé." }, { status: 409 })
  if (!don.paymentMethod || don.paymentMethod === "STRIPE")
    return NextResponse.json({ error: "Ce don n'attend pas d'encaissement manuel." }, { status: 422 })

  const paidAt = new Date()

  // Atomic conditional update — a double-click must not book the Income twice.
  const { count } = await prisma.don.updateMany({
    where: { id, paidAt: null },
    data:  { paidAt },
  })
  if (count === 0) return NextResponse.json({ error: "Ce don est déjà encaissé." }, { status: 409 })

  const exercice = await resolveExerciceForDate(don.associationId, paidAt)
  await prisma.income.create({
    data: {
      associationId: don.associationId,
      exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
      amount:        don.amount,
      description:   `Don de ${don.donorType === "COMPANY" ? (don.companyName ?? don.firstName) : `${don.firstName} ${don.lastName}`}`,
      paymentMethod: don.paymentMethod,
      source:        "MANUAL",
      status:        "PAID",
      date:          paidAt,
    },
  })

  const assoc = don.association
  const issueReceipt = don.receiptMode !== "NONE"

  if (don.email) {
    let pdfAttachment: { filename: string; content: Buffer } | undefined
    if (assoc.canIssueTaxReceipts && issueReceipt) {
      try {
        const updatedDon = await prisma.don.findUnique({ where: { id } })
        if (updatedDon) {
          const pdf = await generateRecuFiscalForDon(updatedDon, assoc)
          pdfAttachment = { filename: `recu-fiscal-${updatedDon.receiptNumber ?? id}.pdf`, content: pdf }
        }
      } catch (err) {
        console.error(`[recu-fiscal] failed to generate for don ${id}:`, err)
      }
    }

    const refreshed = await prisma.don.findUnique({ where: { id }, select: { receiptNumber: true } })

    sendEmail({
      ...donConfirmationEmail({
        firstName:           don.firstName,
        email:               don.email,
        associationName:     assoc.name,
        amount:              Number(don.amount),
        paidAt,
        canIssueTaxReceipts: assoc.canIssueTaxReceipts && issueReceipt,
        receiptNumber:       refreshed?.receiptNumber ?? undefined,
        donorType:           don.donorType,
        deductibleAmount:    don.receiptMode === "PARTIAL" && don.deductibleAmount != null ? Number(don.deductibleAmount) : undefined,
        branding:            resolveDocumentBranding(assoc),
      }),
      attachments: pdfAttachment ? [pdfAttachment] : undefined,
    }, { associationId: don.associationId, membreId: don.membreId ?? undefined, source: "TRANSACTION", sourceId: id }).catch(() => {})
  }

  await writeActivityLog({
    associationId: don.associationId,
    actorId:       ctx.userId,
    action:        "DON_ENCAISSE",
    entity:        "Don",
    entityId:      id,
    label:         don.donorType === "COMPANY" ? (don.companyName ?? don.firstName) : `${don.firstName} ${don.lastName}`,
    metadata:      { amount: Number(don.amount), paymentMethod: don.paymentMethod },
  })

  return NextResponse.json({ ok: true })
}, { module: "dons" })
