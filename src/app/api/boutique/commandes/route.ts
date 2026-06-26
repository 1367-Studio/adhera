import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status  = searchParams.get("status") || undefined
  const page    = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10))
  const limit   = Math.min(50, parseInt(searchParams.get("limit") ?? "25", 10))

  const where = {
    associationId: ctx.associationId,
    ...(status ? { status: status as "PENDING" | "PAID" | "CANCELLED" } : {}),
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
}
