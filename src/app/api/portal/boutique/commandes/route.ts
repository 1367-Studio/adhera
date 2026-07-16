import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"
import { sendEmail } from "@/lib/mail"
import { boutiqueNewOrderAdminEmail } from "@/lib/email"
import { pusherServer } from "@/lib/pusher-server"

const itemSchema = z.object({
  produitId:  z.string(),
  varianteId: z.string(),
  quantity:   z.number().int().min(1).max(99),
})

const checkoutSchema = z.object({
  items:         z.array(itemSchema).min(1).max(50),
  paymentMethod: z.enum(["STRIPE", "MANUAL"]).default("MANUAL"),
  note:          z.string().trim().max(500).optional().nullable(),
})

export const GET = withPortalAuth(async (_req, ctx) => {
  const commandes = await prisma.boutiqueCommande.findMany({
    where:   { associationId: ctx.associationId, membreId: ctx.membreId! },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          produit:  { select: { name: true, imageUrl: true } },
          variante: { select: { label: true } },
        },
      },
    },
  })

  return NextResponse.json(commandes)
}, { module: "boutique" })

export const POST = withPortalAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = checkoutSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { items, paymentMethod, note } = parsed.data

  const commande = await prisma.$transaction(async tx => {
    let totalAmount = 0
    const lineItems: Array<{ produitId: string; varianteId: string; quantity: number; unitPrice: number; categoryId: string | null }> = []

    for (const item of items) {
      const variante = await tx.boutiqueVariante.findFirst({
        where:   { id: item.varianteId, produitId: item.produitId },
        include: { produit: { select: { associationId: true, status: true, categoryId: true } } },
      })

      if (!variante || variante.produit.associationId !== ctx.associationId)
        throw new Error(`Variante introuvable: ${item.varianteId}`)
      if (variante.produit.status !== "ACTIVE")
        throw new Error(`Produit non disponible`)
      if (variante.stock < item.quantity)
        throw new Error(`Stock insuffisant pour "${variante.label}" (disponible: ${variante.stock})`)

      await tx.boutiqueVariante.update({
        where: { id: variante.id },
        data:  { stock: { decrement: item.quantity } },
      })

      totalAmount += variante.price * item.quantity
      lineItems.push({
        produitId:  item.produitId,
        varianteId: item.varianteId,
        quantity:   item.quantity,
        unitPrice:  variante.price,
        // Snapshot the product's category as of the order — recategorizing the product
        // later shouldn't retroactively change how this order books to Finances.
        categoryId: variante.produit.categoryId,
      })
    }

    return tx.boutiqueCommande.create({
      data: {
        associationId: ctx.associationId,
        membreId:      ctx.membreId!,
        status:        "PENDING",
        paymentMethod,
        totalAmount,
        note: note ?? null,
        items: { create: lineItems },
      },
      include: {
        membre:      { select: { firstName: true, lastName: true } },
        association: { select: { name: true } },
        items: {
          include: {
            produit:  { select: { name: true, imageUrl: true } },
            variante: { select: { label: true } },
          },
        },
      },
    })
  }, { isolationLevel: "Serializable" })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_COMMANDE_CREATED",
    entity:        "BoutiqueCommande",
    entityId:      commande.id,
    label:         `${(commande.totalAmount / 100).toFixed(2)} €`,
  })

  // A manual order commits the member to picking it up/paying in person, so admins
  // should know about it as soon as it's placed — not just once it's encaissé.
  if (paymentMethod === "MANUAL") {
    const admins = await prisma.user.findMany({
      where:  { associationId: ctx.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"] }, active: true },
      select: { id: true, email: true },
    })
    if (admins.length) {
      const buyerLabel = commande.membre ? `${commande.membre.firstName} ${commande.membre.lastName}` : "Un membre"
      await prisma.notification.createMany({
        data: admins.map(a => ({
          userId: a.id,
          title:  "Nouvelle commande boutique",
          body:   `${buyerLabel} a passé une commande de ${(commande.totalAmount / 100).toFixed(2)} €`,
          link:   `/dashboard/boutique`,
        })),
        skipDuplicates: true,
      })
      await pusherServer.trigger(`private-association-${ctx.associationId}`, "new-notification", {}).catch(() => {})

      const dashboardUrl = `${process.env.NEXTAUTH_URL ?? ""}/dashboard/boutique`
      for (const admin of admins) {
        if (!admin.email) continue
        // Logged via `context` (status SENT/FAILED on EmailMessage) instead of a bare
        // .catch swallow — the whole point of this email is "the admin finds out", so a
        // silent Resend failure here must stay diagnosable, not disappear.
        sendEmail(boutiqueNewOrderAdminEmail({
          email:           admin.email,
          associationName: commande.association.name,
          buyerLabel,
          totalAmount:     commande.totalAmount,
          dashboardUrl,
        }), { associationId: ctx.associationId, source: "BOUTIQUE_ADMIN_ALERT", sourceId: commande.id })
          .catch(err => console.error(`[boutique-admin-alert] failed to email admin ${admin.email} for commande ${commande.id}:`, err))
      }
    }
  }

  return NextResponse.json(commande, { status: 201 })
}, { module: "boutique" })
