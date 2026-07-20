import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { customEmail, escapeHtml } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const ALLOWED = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const schema = z.object({
  to:      z.string().trim().email("Email invalide"),
  message: z.string().trim().optional(),
})

export const POST = withAdminAuth<{ id: string; loanId: string }>(async (req, ctx, { id, loanId }) => {
  const { associationId, userId } = ctx

  const loan = await prisma.materialLoan.findFirst({
    where:   { id: loanId, materialId: id, material: { associationId } },
    include: { material: true, membre: { select: { firstName: true, lastName: true, email: true } } },
  })
  if (!loan) return NextResponse.json({ error: "Prêt introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })
  const { to, message } = parsed.data

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, address: true, city: true, siren: true, website: true, iban: true, bic: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
  const branding = resolveDocumentBranding(association)

  const borrowerName = loan.membre ? `${loan.membre.firstName} ${loan.membre.lastName}` : (loan.borrowerName ?? "Externe")
  const unitPrice     = Number(loan.feeAmount ?? 0)
  const number        = `PRET-${loan.id.slice(-8).toUpperCase()}`

  const pdf = await buildDocumentPdf({
    kind:           "MATERIEL_LOAN",
    number,
    issueDate:      loan.borrowedAt,
    secondaryLabel: "Retour prévu",
    secondaryDate:  loan.expectedReturnAt,
    association: { ...association, ...branding },
    fournisseur: {
      companyName: borrowerName,
      address:     null,
      city:        null,
      postalCode:  null,
      siret:       null,
      vatNumber:   null,
    },
    items: [{
      description: loan.material.name + (loan.notes ? ` — ${loan.notes}` : ""),
      quantity:    loan.quantity,
      unitPrice,
      vatRate:     0,
      discount:    0,
    }],
    subtotal:       loan.quantity * unitPrice,
    vatAmount:      0,
    discountAmount: 0,
    total:          loan.quantity * unitPrice,
    notes:          null,
    paymentTerms:   null,
  })

  const subject  = `Bon de prêt ${number} — ${association.name}`
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;">Bonjour,</p>
    <p style="margin:0 0 16px;font-size:15px;">Veuillez trouver ci-joint le bon de prêt pour « ${escapeHtml(loan.material.name)} », de ${association.name}.</p>
    ${message ? `<p style="margin:0 0 16px;font-size:15px;white-space:pre-wrap;">${escapeHtml(message)}</p>` : ""}
    <p style="margin:0;font-size:15px;">Cordialement,<br>${association.name}</p>
  `

  await sendEmail({
    ...customEmail({ associationName: association.name, subject, bodyHtml, recipientEmail: to, branding }),
    attachments: [{ filename: `${number}.pdf`, content: pdf }],
  }, { associationId, source: "DOCUMENT", sourceId: loanId })

  await writeActivityLog({
    associationId, actorId: userId,
    action:   "LOAN_EMAIL_SENT",
    entity:   "MaterialLoan",
    entityId: loanId,
    label:    `${loan.material.name} — ${borrowerName}`,
    metadata: { to, subject },
  })

  return NextResponse.json({ ok: true })
}, { roles: ALLOWED, module: "materiel" })
