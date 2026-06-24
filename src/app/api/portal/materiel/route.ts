import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string; associationId?: string | null }

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await prisma.membre.findFirst({
    where:  { userId: u.id!, associationId: u.associationId, deletedAt: null },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [materials, myLoans] = await Promise.all([
    // Fix 7: exclude PERDU/HORS_SERVICE from member catalog
    prisma.material.findMany({
      where:   { associationId: u.associationId, status: { notIn: ["PERDU", "HORS_SERVICE"] } },
      orderBy: { name: "asc" },
      include: {
        loans: {
          where:  { returnedAt: null, status: "CONFIRME" },
          select: { quantity: true },
        },
      },
    }),
    // Fix 1: include REFUSE loans (last 30 days) so member knows they were denied
    prisma.materialLoan.findMany({
      where: {
        membreId: membre.id,
        material: { associationId: u.associationId },
        OR: [
          { returnedAt: null, status: { in: ["DEMANDE", "CONFIRME"] } },
          { status: "REFUSE", createdAt: { gte: thirtyDaysAgo } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        material: { select: { id: true, name: true, category: true } },
      },
    }),
  ])

  const catalog = materials.map(m => {
    const loanedQty = m.loans.reduce((s, l) => s + l.quantity, 0)
    return {
      id:           m.id,
      name:         m.name,
      category:     m.category,
      description:  m.description,
      location:     m.location,
      quantity:     m.quantity,
      status:       m.status,
      availableQty: Math.max(0, m.quantity - loanedQty), // Fix 10: clamp to 0
    }
  })

  return NextResponse.json({ catalog, myLoans })
}
