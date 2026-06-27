import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

type SessionUser = { id?: string; associationId?: string | null }
type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])),
})

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const guard = await guardModule(u.associationId, "sondages")
  if (guard) return guard

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
    include: { questions: true },
  })
  if (!sondage) return NextResponse.json({ error: "Sondage introuvable ou fermé" }, { status: 404 })

  // Prevent double submission — always check by real membreId, even for anonymous sondages
  const existing = await prisma.sondageReponse.findFirst({
    where: { sondageId: id, membreId: membre.id },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ error: "Vous avez déjà répondu à ce sondage" }, { status: 409 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { answers } = parsed.data

  // Validate required questions (considering conditions)
  // For simplicity, we trust the client to apply conditional logic;
  // server only checks required questions that have no condition
  for (const q of sondage.questions) {
    if (!q.required) continue
    if (q.condition) continue // conditionally shown — skip server-side required check
    const ans = answers[q.id]
    if (ans === null || ans === undefined || ans === "" || (Array.isArray(ans) && ans.length === 0)) {
      return NextResponse.json({ error: `La question "${q.label}" est obligatoire` }, { status: 422 })
    }
  }

  const reponse = await prisma.sondageReponse.create({
    data: {
      sondageId: id,
      membreId:  membre.id,  // always stored for dedup; anonymity is enforced at result display level
      items: {
        create: Object.entries(answers)
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .map(([questionId, value]) => ({
            questionId,
            value: Array.isArray(value) ? JSON.stringify(value) : String(value),
          })),
      },
    },
  })

  await writeActivityLog({
    associationId: u.associationId,
    actorId:       u.id!,
    action:        "SONDAGE_REPONSE_SUBMITTED",
    entity:        "SondageReponse",
    entityId:      reponse.id,
    label:         sondage.title,
  })

  return NextResponse.json({ ok: true, reponseId: reponse.id }, { status: 201 })
}
