import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const association = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const types = await prisma.membreType.findMany({
    where:   { associationId: association.id },
    orderBy: { createdAt: "asc" },
    select:  { id: true, name: true },
  })

  return NextResponse.json(types)
}
