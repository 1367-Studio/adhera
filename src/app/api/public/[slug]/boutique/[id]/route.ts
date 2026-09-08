import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, modules: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.boutique) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const produit = await prisma.boutiqueProduit.findFirst({
    where:   { id, associationId: assoc.id, status: "ACTIVE" },
    include: {
      variantes: {
        orderBy: { createdAt: "asc" },
        select:  { id: true, label: true, price: true, stock: true },
      },
    },
  })
  if (!produit) return NextResponse.json({ error: "Produit introuvable" }, { status: 404 })

  return NextResponse.json(produit)
}
