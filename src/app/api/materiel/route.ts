import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import type { SessionUser } from "@/lib/user-context"
import { writeActivityLog } from "@/lib/activity-log"

const ALLOWED = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const schema = z.object({
  name:          z.string().min(1).max(150),
  category:      z.string().max(80).optional().nullable(),
  description:   z.string().max(1000).optional().nullable(),
  serialNumber:  z.string().max(100).optional().nullable(),
  quantity:      z.number().int().min(1).default(1),
  status:        z.enum(["DISPONIBLE", "EN_USE", "EN_MAINTENANCE", "HORS_SERVICE", "PERDU"]).default("DISPONIBLE"),
  location:      z.string().max(150).optional().nullable(),
  purchaseDate:  z.string().optional().nullable(),
  purchasePrice: z.number().positive().optional().nullable(),
  notes:         z.string().max(1000).optional().nullable(),
})

export async function GET() {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const materials = await prisma.material.findMany({
    where:   { associationId: u.associationId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { loans: { where: { returnedAt: null } } } },
      loans: {
        where:  { returnedAt: null, status: { in: ["CONFIRME", "DEMANDE"] } },
        select: {
          id: true, quantity: true, status: true, membreId: true,
          borrowerName: true, borrowedAt: true, expectedReturnAt: true, notes: true,
          membre: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })

  const result = materials.map(m => {
    const confirmedLoans = m.loans.filter(l => l.status === "CONFIRME")
    const pendingLoans   = m.loans.filter(l => l.status === "DEMANDE")
    return {
      ...m,
      loanedQty:            confirmedLoans.reduce((s, l) => s + l.quantity, 0),
      availableQty:         m.quantity - confirmedLoans.reduce((s, l) => s + l.quantity, 0),
      pendingDemandesCount: pendingLoans.length,
      pendingDemandes:      pendingLoans,
      loans:                undefined,
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: Request) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { purchaseDate, purchasePrice, ...rest } = parsed.data
  const material = await prisma.material.create({
    data: {
      ...rest,
      associationId: u.associationId,
      purchaseDate:  purchaseDate ? new Date(purchaseDate) : null,
      purchasePrice: purchasePrice ?? null,
    },
  })

  await writeActivityLog({ associationId: u.associationId, actorId: u.id, action: "MATERIEL_CREATED", entity: "Material", entityId: material.id, label: material.name })
  return NextResponse.json(material, { status: 201 })
}
