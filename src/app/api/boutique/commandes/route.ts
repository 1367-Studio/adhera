import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { nextBoutiqueReceiptNumber } from "@/lib/document-numbering"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"
import { bookBoutiqueOrderIncome } from "@/lib/boutique/book-income"
import { resolveBoutiqueResponsable } from "@/lib/boutique/responsable"
import { sendEmail } from "@/lib/mail"
import { boutiqueConfirmationEmail, boutiquePendingOrderEmail, boutiqueNewOrderAdminEmail } from "@/lib/email"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { APP_URL } from "@/lib/env"
import { reportError } from "@/lib/monitoring"

export const GET = withAdminAuth(async (req, ctx) => {
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const { searchParams } = new URL(req.url)
  const status   = searchParams.get("status") || undefined
  const membreId = searchParams.get("membreId") || undefined
  const page      = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10))
  const limit     = Math.min(50, parseInt(searchParams.get("limit") ?? "25", 10))

  const where = {
    associationId: ctx.associationId,
    ...(status   ? { status: status as "PENDING" | "PAID" | "CANCELLED" } : {}),
    ...(membreId ? { membreId } : {}),
  }

  const [commandes, total] = await Promise.all([
    prisma.boutiqueCommande.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
      include: {
        membre: { select: { firstName: true, lastName: true, email: true } },
        items:  {
          include: {
            produit:  { select: { id: true, name: true } },
            variante: { select: { label: true } },
          },
        },
      },
    }),
    prisma.boutiqueCommande.count({ where }),
  ])

  return NextResponse.json({
    data:       commandes,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
}, { area: "boutique" })

const createSchema = z.object({
  membreId:          z.string().optional(),
  guestFirstName:    z.string().trim().max(100).optional(),
  guestLastName:     z.string().trim().max(100).optional(),
  guestEmail:        z.string().trim().email().max(255).optional().or(z.literal("")),
  items:             z.array(z.object({
    produitId:  z.string(),
    varianteId: z.string(),
    quantity:   z.number().int().min(1).max(99),
  })).min(1).max(50),
  note:              z.string().trim().max(500).optional().nullable(),
  purchaseDate:      z.string(),
  paymentStatus:     z.enum(["PAID", "PENDING"]),
  manualPaymentType: z.enum(["ESPECES", "CHEQUE", "CB", "VIREMENT"]).optional(),
  sendBuyerEmail:     z.boolean().default(false),
  notifyResponsible:  z.boolean().default(false),
})

export const POST = withAdminAuth(async (req, ctx) => {
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const {
    membreId, guestFirstName, guestLastName, guestEmail, items, note,
    purchaseDate, paymentStatus, manualPaymentType, sendBuyerEmail, notifyResponsible,
  } = parsed.data

  const hasMembre = !!membreId
  const hasGuest  = !!(guestFirstName?.trim() && guestLastName?.trim())
  if (hasMembre === hasGuest)
    return NextResponse.json({ error: "Choisissez un contact existant ou renseignez une personne externe (pas les deux)" }, { status: 422 })
  if (paymentStatus === "PAID" && !manualPaymentType)
    return NextResponse.json({ error: "Le moyen de paiement est requis" }, { status: 422 })

  const purchaseDateParsed = new Date(purchaseDate)
  if (Number.isNaN(purchaseDateParsed.getTime()))
    return NextResponse.json({ error: "Date invalide" }, { status: 422 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: {
      id: true, name: true, slug: true, address: true, city: true, siren: true, website: true,
      iban: true, bic: true, plan: true, customBrandingEnabled: true, logoUrl: true,
    },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  let membre: { firstName: string; lastName: string; email: string | null } | null = null
  if (hasMembre) {
    membre = await prisma.membre.findFirst({
      where:  { id: membreId, associationId: ctx.associationId, deletedAt: null },
      select: { firstName: true, lastName: true, email: true },
    })
    if (!membre) return NextResponse.json({ error: "Contact introuvable" }, { status: 404 })
  }

  let exercice: Awaited<ReturnType<typeof resolveExerciceForDate>> = null
  if (paymentStatus === "PAID") {
    exercice = await resolveExerciceForDate(ctx.associationId, purchaseDateParsed)
    const exerciceGuard = closedExerciceGuard(exercice?.status)
    if (exerciceGuard) return exerciceGuard
  }

  const guestName   = hasGuest ? `${guestFirstName!.trim()} ${guestLastName!.trim()}` : null
  const guestEmailV = hasGuest && guestEmail ? guestEmail.trim() : null
  const trackingToken = hasGuest ? randomBytes(20).toString("hex") : null
  const buyerLabel  = membre ? `${membre.firstName} ${membre.lastName}` : guestName

  let commandeId = ""
  let receiptNumber: string | null = null
  let totalAmount = 0
  let lineItemsForEmail: { name: string; quantity: number; unitPrice: number }[] = []

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidateReceiptNumber = paymentStatus === "PAID" ? await nextBoutiqueReceiptNumber(ctx.associationId) : null
    try {
      const result = await prisma.$transaction(async tx => {
        let runningTotal = 0
        const lineItems: Array<{
          produitId: string; varianteId: string; quantity: number; unitPrice: number; categoryId: string | null; produitName: string; varianteLabel: string
        }> = []

        for (const item of items) {
          const variante = await tx.boutiqueVariante.findFirst({
            where:   { id: item.varianteId, produitId: item.produitId },
            include: { produit: { select: { associationId: true, status: true, categoryId: true, name: true } } },
          })
          if (!variante || variante.produit.associationId !== ctx.associationId)
            throw new Error("Produit introuvable")
          if (variante.produit.status !== "ACTIVE")
            throw new Error(`Le produit "${variante.produit.name}" n'est pas disponible`)
          if (variante.stock < item.quantity)
            throw new Error(`Stock insuffisant pour "${variante.label}" (disponible : ${variante.stock})`)

          await tx.boutiqueVariante.update({
            where: { id: variante.id },
            data:  { stock: { decrement: item.quantity } },
          })

          runningTotal += variante.price * item.quantity
          lineItems.push({
            produitId: item.produitId, varianteId: item.varianteId, quantity: item.quantity,
            unitPrice: variante.price, categoryId: variante.produit.categoryId,
            produitName: variante.produit.name, varianteLabel: variante.label,
          })
        }

        const commande = await tx.boutiqueCommande.create({
          data: {
            associationId:  ctx.associationId,
            membreId:       membreId ?? null,
            guestName,
            guestEmail:     guestEmailV,
            trackingToken,
            status:         paymentStatus,
            paymentMethod:  "MANUAL",
            manualPaymentType: paymentStatus === "PAID" ? manualPaymentType : null,
            source:         "STOREFRONT",
            createdByUserId: ctx.userId,
            note:           note ?? null,
            totalAmount:    runningTotal,
            createdAt:      purchaseDateParsed,
            ...(paymentStatus === "PAID" ? { receiptNumber: candidateReceiptNumber, paidAt: purchaseDateParsed } : {}),
            items: { create: lineItems.map(l => ({ produitId: l.produitId, varianteId: l.varianteId, quantity: l.quantity, unitPrice: l.unitPrice, categoryId: l.categoryId })) },
          },
        })

        if (paymentStatus === "PAID") {
          await bookBoutiqueOrderIncome(tx, {
            associationId: ctx.associationId,
            exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
            membreId:      membreId ?? null,
            commandeId:    commande.id,
            items:         lineItems.map(l => ({ quantity: l.quantity, unitPrice: l.unitPrice, categoryId: l.categoryId, produitName: l.produitName })),
            shippingCost:          0,
            shippingCarrierLabel:  null,
            buyerLabel,
            paymentMethod: manualPaymentType!,
            paidAt:        purchaseDateParsed,
          })
        }

        return { commandeId: commande.id, totalAmount: runningTotal, lineItems }
      })

      commandeId         = result.commandeId
      totalAmount         = result.totalAmount
      receiptNumber       = candidateReceiptNumber
      lineItemsForEmail    = result.lineItems.map(l => ({ name: `${l.produitName} – ${l.varianteLabel}`, quantity: l.quantity, unitPrice: l.unitPrice }))
      break
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 4) continue
      const message = err instanceof Error ? err.message : "Erreur"
      return NextResponse.json({ error: message }, { status: 422 })
    }
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_COMMANDE_CREATED",
    entity:        "BoutiqueCommande",
    entityId:      commandeId,
    label:         `${(totalAmount / 100).toFixed(2)} € (manuel${paymentStatus === "PENDING" ? ", en attente" : ""})`,
  })

  // Best-effort e-mails — never fail the request over a Resend hiccup.
  const recipientEmail     = membre?.email ?? guestEmailV
  const recipientFirstName = membre?.firstName ?? guestFirstName?.trim() ?? "Client"

  if (sendBuyerEmail && recipientEmail) {
    const branding = await resolveEmailBranding(ctx.associationId)
    if (paymentStatus === "PAID") {
      let pdfAttachment: { filename: string; content: Buffer } | undefined
      try {
        const pdf = await buildDocumentPdf({
          kind:           "BOUTIQUE",
          number:         receiptNumber!,
          issueDate:      purchaseDateParsed,
          secondaryLabel: "Payé le",
          secondaryDate:  purchaseDateParsed,
          association:    { ...assoc, ...branding },
          fournisseur:    { companyName: buyerLabel ?? recipientFirstName, address: null, city: null, postalCode: null, siret: null, vatNumber: null },
          items:          lineItemsForEmail.map(i => ({ description: i.name, quantity: i.quantity, unitPrice: i.unitPrice / 100, vatRate: 0, discount: 0 })),
          subtotal:       totalAmount / 100,
          vatAmount:      0,
          discountAmount: 0,
          total:          totalAmount / 100,
          amountPaid:     totalAmount / 100,
          notes:          note ?? null,
          paymentTerms:   "Payé en main (enregistré manuellement).",
        })
        pdfAttachment = { filename: `recu-${receiptNumber}.pdf`, content: pdf }
      } catch (err) {
        reportError(err, { area: "api", action: "boutique.manual-commande.receipt-pdf", extra: { associationId: ctx.associationId, commandeId } })
      }

      const portalUrl = membre
        ? `${APP_URL}/portal/${assoc.slug}/boutique/commandes`
        : trackingToken
          ? `${APP_URL}/${assoc.slug}/boutique/pedido/${trackingToken}`
          : `${APP_URL}/${assoc.slug}`

      sendEmail({
        ...boutiqueConfirmationEmail({
          firstName: recipientFirstName, email: recipientEmail, associationName: assoc.name,
          totalAmount, paidAt: purchaseDateParsed, items: lineItemsForEmail, portalUrl, branding,
        }),
        attachments: pdfAttachment ? [pdfAttachment] : undefined,
      }, { associationId: ctx.associationId, membreId: membreId ?? undefined, source: "TRANSACTION", sourceId: commandeId })
        .catch(error => reportError(error, { area: "email", action: "boutique.manual-commande.confirmation-email", extra: { associationId: ctx.associationId, commandeId } }))
    } else {
      const trackingUrl = membre
        ? `${APP_URL}/portal/${assoc.slug}/boutique/commandes`
        : `${APP_URL}/${assoc.slug}/boutique/pedido/${trackingToken}`

      sendEmail(boutiquePendingOrderEmail({
        firstName: recipientFirstName, email: recipientEmail, associationName: assoc.name,
        totalAmount, items: lineItemsForEmail, trackingUrl, branding,
      }), { associationId: ctx.associationId, membreId: membreId ?? undefined, source: "TRANSACTION", sourceId: commandeId })
        .catch(error => reportError(error, { area: "email", action: "boutique.manual-commande.pending-email", extra: { associationId: ctx.associationId, commandeId } }))
    }
  }

  const responsable = notifyResponsible ? await resolveBoutiqueResponsable(ctx.associationId) : null
  if (responsable) {
    const paymentStatusLabel = paymentStatus === "PAID"
      ? `Payée (${manualPaymentType})`
      : "En attente de paiement"
    sendEmail(boutiqueNewOrderAdminEmail({
      email:              responsable.email,
      associationName:    assoc.name,
      buyerLabel:         buyerLabel ?? "Un invité",
      totalAmount,
      items:              lineItemsForEmail,
      paymentStatusLabel,
      dashboardUrl:       `${APP_URL}/dashboard/boutique?tab=commandes&commandeId=${commandeId}`,
    }), { associationId: ctx.associationId, source: "BOUTIQUE_ADMIN_ALERT", sourceId: commandeId })
      .catch(error => reportError(error, { area: "email", action: "boutique.manual-commande.responsible-alert-email", extra: { associationId: ctx.associationId, commandeId } }))
  }

  const created = await prisma.boutiqueCommande.findUnique({
    where:   { id: commandeId },
    include: {
      membre: { select: { firstName: true, lastName: true, email: true } },
      items:  { include: { produit: { select: { name: true, imageUrl: true } }, variante: { select: { label: true, price: true } } } },
    },
  })
  return NextResponse.json(created, { status: 201 })
}, { area: "boutique" })
