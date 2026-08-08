import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"
import { startOfTodayUTC } from "@/lib/date-boundaries"
import { pusherServer } from "@/lib/pusher-server"

const SONDAGE_MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"] as const

type Params = { id: string }

class SondageClosedError extends Error {}

const schema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])),
})

type NotifyCtx = { userId: string; associationId: string; membreId: string | null }

async function notifyAdminsOfResponse(
  ctx: NotifyCtx,
  sondage: { title: string; anonymous: boolean },
  sondageId: string,
) {
  const admins = await prisma.user.findMany({
    where: {
      associationId: ctx.associationId,
      role:          { in: [...SONDAGE_MANAGERS] },
      active:        true,
      id:            { not: ctx.userId }, // don't notify an admin about their own response
    },
    select: { id: true },
  })
  if (!admins.length) return

  // Respect the sondage's own anonymity setting — don't leak the respondent's
  // name in the notification body if results are supposed to stay anonymous.
  let respondentLabel = "Un membre"
  if (!sondage.anonymous && ctx.membreId) {
    const membre = await prisma.membre.findUnique({
      where:  { id: ctx.membreId },
      select: { firstName: true, lastName: true },
    })
    if (membre) respondentLabel = `${membre.firstName} ${membre.lastName}`
  }

  // Group repeated responses to the same sondage into one unread row per admin instead of
  // one row per response — a popular sondage otherwise floods the bell and buries unread
  // notifications from unrelated features under `/api/notifications`'s take: 50 window.
  // Grouping resets once the admin reads it (the read=false filter no longer matches),
  // so it always reflects "what's new since you last checked".
  const groupKey = `sondage-response:${sondageId}`
  const link     = `/dashboard/sondages/${sondageId}?tab=reponses`

  await Promise.all(admins.map(async (admin) => {
    const existing = await prisma.notification.findFirst({
      where:  { userId: admin.id, groupKey, read: false },
      select: { id: true, count: true },
    })
    if (existing) {
      const count = existing.count + 1
      await prisma.notification.update({
        where: { id: existing.id },
        data: {
          count,
          title:     `${count} nouvelles réponses — sondage « ${sondage.title} »`,
          body:      `Dernière réponse : ${respondentLabel}`,
          createdAt: new Date(), // bump back to the top of the createdAt-desc list
        },
      })
    } else {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          groupKey,
          count:  1,
          title:  `Nouvelle réponse — sondage « ${sondage.title} »`,
          body:   `${respondentLabel} a répondu`,
          link,
          scope:  "GESTION",
        },
      })
    }
  }))
  await pusherServer.trigger(`private-association-${ctx.associationId}`, "new-notification", {}).catch(() => {})
}

export const POST = withPortalAuth<Params>(async (req, ctx, { id }) => {
  const sondage = await prisma.sondage.findFirst({
    where: {
      id,
      associationId: ctx.associationId,
      status:        "ACTIF",
      OR: [{ deadline: null }, { deadline: { gte: startOfTodayUTC() } }],
    },
    include: { questions: true },
  })
  if (!sondage) return NextResponse.json({ error: "Sondage introuvable ou fermé" }, { status: 404 })

  // Check membership in recipients for SELECTED mode — same guard as the GET route,
  // otherwise a member outside the selected audience could still submit a response.
  if (sondage.recipientMode === "SELECTED") {
    const recipient = await prisma.sondageRecipient.findUnique({
      where: { sondageId_membreId: { sondageId: id, membreId: ctx.membreId! } },
    })
    if (!recipient) return NextResponse.json({ error: "Non autorisé" }, { status: 403 })
  }

  // Prevent double submission — always check by real membreId, even for anonymous sondages
  const existing = await prisma.sondageReponse.findFirst({
    where: { sondageId: id, membreId: ctx.membreId! },
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

  let reponse
  try {
    reponse = await prisma.$transaction(async (tx) => {
      // Re-check status inside the transaction — an admin could have closed the sondage
      // in between the initial lookup above and this write.
      const current = await tx.sondage.findUnique({ where: { id }, select: { status: true } })
      if (current?.status !== "ACTIF") {
        throw new SondageClosedError()
      }
      return tx.sondageReponse.create({
        data: {
          sondageId: id,
          membreId:  ctx.membreId!,  // always stored for dedup; anonymity is enforced at result display level
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
    })
  } catch (err) {
    if (err instanceof SondageClosedError) {
      return NextResponse.json({ error: "Ce sondage vient d'être fermé" }, { status: 409 })
    }
    // Race with another concurrent submission (double-click) hitting the same
    // @@unique([sondageId, membreId]) constraint the check above already tries to catch.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Vous avez déjà répondu à ce sondage" }, { status: 409 })
    }
    throw err
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SONDAGE_REPONSE_SUBMITTED",
    entity:        "SondageReponse",
    entityId:      reponse.id,
    label:         sondage.title,
  })

  // The member's response is already committed at this point — a failure notifying
  // admins must never surface as an error to the member (they'd see a 500 despite their
  // answer being saved, and a retry would just hit the "already answered" 409). Still
  // awaited (not fire-and-forget) so it isn't cut short if the platform tears the
  // function down right after the response is sent.
  await notifyAdminsOfResponse(ctx, sondage, id).catch(() => {})

  return NextResponse.json({ ok: true, reponseId: reponse.id }, { status: 201 })
}, { module: "sondages" })
