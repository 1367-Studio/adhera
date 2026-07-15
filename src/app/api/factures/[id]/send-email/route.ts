import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { customEmail, escapeHtml } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const schema = z.object({
  to:      z.string().trim().email("Email invalide"),
  message: z.string().trim().optional(),
})

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const facture = await prisma.facture.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } }, fournisseur: true },
  })
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { to, message } = parsed.data

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, address: true, city: true, siren: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const pdf = await buildDocumentPdf({
    kind:           "FACTURE",
    number:         facture.number,
    issueDate:      facture.issueDate,
    secondaryLabel: "Échéance",
    secondaryDate:  facture.dueDate,
    association: { ...association, ...resolveDocumentBranding(association) },
    fournisseur: facture.fournisseur ? {
      companyName: facture.fournisseur.companyName,
      address:     facture.fournisseur.address,
      city:        facture.fournisseur.city,
      postalCode:  facture.fournisseur.postalCode,
      siret:       facture.fournisseur.siret,
      vatNumber:   facture.fournisseur.vatNumber,
    } : null,
    items: facture.items.map(i => ({
      description: i.description,
      quantity:    Number(i.quantity),
      unitPrice:   Number(i.unitPrice),
      vatRate:     Number(i.vatRate),
      discount:    Number(i.discount),
    })),
    subtotal:       Number(facture.subtotal),
    vatAmount:      Number(facture.vatAmount),
    discountAmount: Number(facture.discountAmount),
    total:          Number(facture.total),
    amountPaid:     Number(facture.amountPaid),
    notes:          facture.notes,
    paymentTerms:   facture.paymentTerms,
  })

  const subject  = `Facture ${facture.number} — ${association.name}`
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;">Bonjour,</p>
    <p style="margin:0 0 16px;font-size:15px;">Veuillez trouver ci-joint la facture <strong>${facture.number}</strong> de ${association.name}.</p>
    ${message ? `<p style="margin:0 0 16px;font-size:15px;white-space:pre-wrap;">${escapeHtml(message)}</p>` : ""}
    <p style="margin:0;font-size:15px;">Cordialement,<br>${association.name}</p>
  `

  await sendEmail({
    ...customEmail({ associationName: association.name, subject, bodyHtml, recipientEmail: to }),
    attachments: [{ filename: `${facture.number}.pdf`, content: pdf }],
  })

  // Sending the email out IS the act of "sending" the facture — no need to make the user
  // separately flip the status afterward if it was still sitting in Brouillon.
  if (facture.status === "BROUILLON") {
    await prisma.facture.update({ where: { id }, data: { status: "EN_ATTENTE", sentAt: new Date() } })
  }

  await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_EMAIL_SENT", entity: "Facture", entityId: id, label: facture.number, metadata: { to, subject } })

  return NextResponse.json({ ok: true })
}, { roles: FINANCE, module: "factures" })
