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
    where:  { userId: u.id!, associationId: u.associationId!, deletedAt: null },
    select: { id: true, email: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const dons = await prisma.don.findMany({
    where:   { associationId: u.associationId!, membreId: membre.id },
    orderBy: { createdAt: "desc" },
    select: {
      id:              true,
      amount:          true,
      message:         true,
      anonymous:       true,
      paidAt:          true,
      createdAt:       true,
      receiptNumber:   true,
      receiptIssuedAt: true,
      association:     { select: { canIssueTaxReceipts: true } },
    },
  })

  return NextResponse.json(dons)
}
