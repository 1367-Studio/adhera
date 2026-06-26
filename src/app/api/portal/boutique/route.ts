import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"

type SessionUser = { id?: string; associationId?: string | null }

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const assoc = await prisma.association.findUnique({
    where:  { id: u.associationId },
    select: { modules: true },
  })
  const modules = parseModules(assoc?.modules)
  if (!modules.boutique)
    return NextResponse.json({ error: "Module boutique désactivé" }, { status: 403 })

  const produits = await prisma.boutiqueProduit.findMany({
    where:   { associationId: u.associationId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      variantes: {
        orderBy: { createdAt: "asc" },
        select:  { id: true, label: true, price: true, stock: true },
      },
    },
  })

  return NextResponse.json(produits)
}
