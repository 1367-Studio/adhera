import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"

// Bearer-token lookup, same convention as Participation.cancelToken/ticketToken — a guest
// storefront buyer has no portal account to authenticate a status page any other way.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; token: string }> },
) {
  const { slug, token } = await params

  const commande = await prisma.boutiqueCommande.findUnique({
    where:   { trackingToken: token },
    include: {
      association: { select: { slug: true, name: true } },
      items: {
        include: {
          produit:  { select: { name: true } },
          variante: { select: { label: true } },
        },
      },
    },
  })
  if (!commande || commande.association.slug !== slug)
    return NextResponse.json({ error: "Commande introuvable" }, { status: 404 })

  return NextResponse.json({
    status:          commande.status,
    guestName:       commande.guestName,
    totalAmount:     commande.totalAmount,
    paymentMethod:   commande.paymentMethod,
    receiptNumber:   commande.receiptNumber,
    createdAt:       commande.createdAt,
    paidAt:          commande.paidAt,
    associationName: commande.association.name,
    items: commande.items.map(i => ({
      name:      `${i.produit.name} – ${i.variante.label}`,
      quantity:  i.quantity,
      unitPrice: i.unitPrice,
    })),
  })
}
