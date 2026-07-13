import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { customEmail, escapeHtml } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const schema = z.object({
  to:      z.string().trim().email("Email invalide"),
  message: z.string().trim().optional(),
})

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const devis = await prisma.devis.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } }, fournisseur: true },
  })
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { to, message } = parsed.data

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, address: true, city: true, siren: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const pdf = await buildDocumentPdf({
    kind:           "DEVIS",
    number:         devis.number,
    issueDate:      devis.issueDate,
    secondaryLabel: "Valide jusqu'au",
    secondaryDate:  devis.validUntil,
    association,
    fournisseur: devis.fournisseur ? {
      companyName: devis.fournisseur.companyName,
      address:     devis.fournisseur.address,
      city:        devis.fournisseur.city,
      postalCode:  devis.fournisseur.postalCode,
      siret:       devis.fournisseur.siret,
      vatNumber:   devis.fournisseur.vatNumber,
    } : null,
    items: devis.items.map(i => ({
      description: i.description,
      quantity:    Number(i.quantity),
      unitPrice:   Number(i.unitPrice),
      vatRate:     Number(i.vatRate),
      discount:    Number(i.discount),
    })),
    subtotal:       Number(devis.subtotal),
    vatAmount:      Number(devis.vatAmount),
    discountAmount: Number(devis.discountAmount),
    total:          Number(devis.total),
    notes:          devis.notes,
    paymentTerms:   devis.paymentTerms,
  })

  const subject  = `Devis ${devis.number} — ${association.name}`
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;">Bonjour,</p>
    <p style="margin:0 0 16px;font-size:15px;">Veuillez trouver ci-joint le devis <strong>${devis.number}</strong> de ${association.name}.</p>
    ${message ? `<p style="margin:0 0 16px;font-size:15px;white-space:pre-wrap;">${escapeHtml(message)}</p>` : ""}
    <p style="margin:0;font-size:15px;">Cordialement,<br>${association.name}</p>
  `

  await sendEmail({
    ...customEmail({ associationName: association.name, subject, bodyHtml, recipientEmail: to }),
    attachments: [{ filename: `${devis.number}.pdf`, content: pdf }],
  })

  // Sending the email out IS the act of "sending" the devis — no need to make the user
  // separately flip the status afterward if it was still sitting in Brouillon.
  if (devis.status === "BROUILLON") {
    await prisma.devis.update({ where: { id }, data: { status: "ENVOYE", sentAt: new Date() } })
  }

  await writeActivityLog({ associationId, actorId: userId, action: "DEVIS_EMAIL_SENT", entity: "Devis", entityId: id, label: devis.number, metadata: { to, subject } })

  return NextResponse.json({ ok: true })
}, { roles: FINANCE, module: "devis" })
