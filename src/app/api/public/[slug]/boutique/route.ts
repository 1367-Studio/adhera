import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { connectAccountChargesEnabled } from "@/lib/stripe"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true, stripeConnectId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.boutique) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const produits = await prisma.boutiqueProduit.findMany({
    where:   { associationId: assoc.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      variantes: {
        orderBy: { createdAt: "asc" },
        select:  { id: true, label: true, price: true, stock: true },
      },
    },
  })

  // Drives whether the storefront even offers "pay online" — without this, a visitor could
  // fill the whole cart + guest form and only discover Stripe isn't configured after
  // clicking submit, same gap the public donation form already avoids via its own
  // `paymentEnabled` flag (see /api/public/[slug]/dons/[formSlug]/route.ts).
  let paymentEnabled = false
  if (assoc.stripeConnectId) {
    try {
      paymentEnabled = await connectAccountChargesEnabled(assoc.stripeConnectId)
    } catch (err) {
      console.error(`[public-boutique] failed to check payment availability for ${slug}:`, err)
    }
  }

  return NextResponse.json({ associationName: assoc.name, produits, paymentEnabled })
}
