import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"

type SessionUser = { id?: string; associationId?: string | null }
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const guard = await guardModule(u.associationId, "boutique")
  if (guard) return guard

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
