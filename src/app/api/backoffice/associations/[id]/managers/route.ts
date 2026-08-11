import { NextResponse }       from "next/server"
import { prisma }             from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"

export const GET = withSuperAdminAuth<{ id: string }>(async (_req, _ctx, { id }) => {
  const exists = await prisma.association.findUnique({
    where:  { id, deletedAt: null },
    select: { id: true },
  })
  if (!exists) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const managers = await prisma.user.findMany({
    where:   { associationId: id, role: { not: "MEMBRE" }, active: true, deletedAt: null },
    orderBy: { role: "asc" },
    select:  { id: true, name: true, email: true, role: true },
  })

  return NextResponse.json(managers)
})
