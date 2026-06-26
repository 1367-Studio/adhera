import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"

type SessionUser = { id?: string; associationId?: string | null }
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
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

  const produit = await prisma.boutiqueProduit.findFirst({
    where:   { id, associationId: u.associationId, status: "ACTIVE" },
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
