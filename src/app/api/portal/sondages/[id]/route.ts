import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string; associationId?: string | null }
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await prisma.membre.findFirst({
    where:  { userId: u.id!, associationId: u.associationId!, deletedAt: null },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const now = new Date()
  const sondage = await prisma.sondage.findFirst({
    where: {
      id,
      associationId: u.associationId!,
      status:        "ACTIF",
      OR: [{ deadline: null }, { deadline: { gte: now } }],
    },
    include: {
      questions: { orderBy: { order: "asc" } },
      reponses:  { where: { membreId: membre.id }, select: { id: true } },
    },
  })

  if (!sondage) return NextResponse.json({ error: "Sondage introuvable ou fermé" }, { status: 404 })

  // Check membership in recipients for SELECTED mode
  if (sondage.recipientMode === "SELECTED") {
    const recipient = await prisma.sondageRecipient.findUnique({
      where: { sondageId_membreId: { sondageId: id, membreId: membre.id } },
    })
    if (!recipient) return NextResponse.json({ error: "Non autorisé" }, { status: 403 })
  }

  return NextResponse.json({
    id:          sondage.id,
    title:       sondage.title,
    description: sondage.description,
    anonymous:   sondage.anonymous,
    deadline:    sondage.deadline,
    questions:   sondage.questions,
    repondu:     sondage.reponses.length > 0,
  })
}
