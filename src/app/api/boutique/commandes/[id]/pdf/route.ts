import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  STRIPE:   "carte bancaire (en ligne)",
  ESPECES:  "espèces",
  CHEQUE:   "chèque",
  CB:       "carte bancaire",
  VIREMENT: "virement",
  MANUAL:   "manuel",
}

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const commande = await prisma.boutiqueCommande.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: {
      membre: { select: { firstName: true, lastName: true } },
      items:  {
        include: {
          produit:  { select: { name: true } },
          variante: { select: { label: true } },
        },
      },
    },
  })
  if (!commande) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  // A "reçu" only makes sense once the sale is actually settled — a PENDING or CANCELLED
  // order producing an identical-looking receipt document would be misleading proof.
  if (commande.status !== "PAID") return NextResponse.json({ error: "Le reçu n'est disponible que pour une commande payée" }, { status: 404 })

  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { name: true, address: true, city: true, siren: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const buyerLabel = commande.membre ? `${commande.membre.firstName} ${commande.membre.lastName}` : commande.guestName
  const paidMethod = commande.paymentMethod === "STRIPE" ? "STRIPE" : commande.manualPaymentType
  // Orders paid before receiptNumber existed fall back to the id-derived label so their
  // PDF keeps working instead of breaking on a null number.
  const number      = commande.receiptNumber ?? id.slice(0, 8).toUpperCase()

  const pdf = await buildDocumentPdf({
    kind:           "BOUTIQUE",
    number,
    issueDate:      commande.createdAt,
    secondaryLabel: "Payé le",
    // Orders paid before `paidAt` existed fall back to `updatedAt` (backfilled by the
    // migration that added the column). Never use `updatedAt` directly here — the
    // payment-type correction flow updates the row after the fact and would otherwise
    // make an old sale's receipt show today's date.
    secondaryDate:  commande.paidAt ?? commande.updatedAt,
    association: { ...association, ...resolveDocumentBranding(association) },
    fournisseur: buyerLabel ? {
      companyName: buyerLabel,
      address:     null,
      city:        null,
      postalCode:  null,
      siret:       null,
      vatNumber:   null,
    } : null,
    items: commande.items.map(i => ({
      description: `${i.produit.name} – ${i.variante.label}`,
      quantity:    i.quantity,
      unitPrice:   i.unitPrice / 100,
      vatRate:     0,
      discount:    0,
    })),
    subtotal:       commande.totalAmount / 100,
    vatAmount:      0,
    discountAmount: 0,
    total:          commande.totalAmount / 100,
    amountPaid:     commande.totalAmount / 100,
    notes:          commande.note,
    paymentTerms:   paidMethod ? `Payé par ${PAYMENT_METHOD_LABEL[paidMethod] ?? paidMethod.toLowerCase()}.` : null,
  })

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="recu-${number}.pdf"`,
    },
  })
})
