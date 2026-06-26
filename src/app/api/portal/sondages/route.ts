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
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const now = new Date()

  // Active sondages for this association that this member is a recipient of
  const sondages = await prisma.sondage.findMany({
    where: {
      associationId: u.associationId!,
      status:        "ACTIF",
      AND: [
        { OR: [{ deadline: null }, { deadline: { gte: now } }] },
        { OR: [
          { recipientMode: "ALL" },
          { recipientMode: "SELECTED", recipients: { some: { membreId: membre.id } } },
        ]},
      ],
    },
    include: {
      _count:    { select: { questions: true } },
      reponses:  { where: { membreId: membre.id }, select: { id: true, submittedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(
    sondages.map(s => ({
      id:          s.id,
      title:       s.title,
      description: s.description,
      deadline:    s.deadline,
      anonymous:   s.anonymous,
      questionsCount: s._count.questions,
      repondu:     s.reponses.length > 0,
      submittedAt: s.reponses[0]?.submittedAt ?? null,
    })),
  )
}
