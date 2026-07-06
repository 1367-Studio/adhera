import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

type Params = { id: string; participationId: string }

const bodySchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName:  z.string().min(1).max(80),
  email:     z.string().email().optional().or(z.literal("")),
})

// Editing/removing is only offered for guest rows (no Membre attached) — a member's own
// name/email comes from their Membre record and shouldn't be forked here.
export const PATCH = withAdminAuth<Params>(async (req, ctx, { id: evenementId, participationId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Impossible de modifier la liste d'un événement déjà passé." }, { status: 422 })

  const participation = await prisma.participation.findFirst({ where: { id: participationId, evenementId } })
  if (!participation) return NextResponse.json({ error: "Participation introuvable" }, { status: 404 })
  if (participation.membreId)
    return NextResponse.json({ error: "Impossible de modifier la fiche d'un membre depuis cet écran" }, { status: 422 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { firstName, lastName, email } = parsed.data

  const updated = await prisma.participation.update({
    where: { id: participationId },
    data:  { firstName, lastName, email: email || null },
  })

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "PARTICIPATION_GUEST_UPDATED",
    entity:   "Participation",
    entityId: participationId,
    label:    evenement.title,
    metadata: { memberName: `${firstName} ${lastName}` },
  })

  return NextResponse.json(updated)
})

export const DELETE = withAdminAuth<Params>(async (_req, ctx, { id: evenementId, participationId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Impossible de modifier la liste d'un événement déjà passé." }, { status: 422 })

  const participation = await prisma.participation.findFirst({ where: { id: participationId, evenementId } })
  if (!participation) return NextResponse.json({ error: "Participation introuvable" }, { status: 404 })
  if (participation.membreId)
    return NextResponse.json({ error: "Impossible de supprimer la fiche d'un membre depuis cet écran" }, { status: 422 })
  if (participation.ticketPaidAt)
    return NextResponse.json({ error: "Ce billet a déjà été payé — annulez le paiement avant de le supprimer" }, { status: 409 })

  await prisma.participation.delete({ where: { id: participationId } })

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "PARTICIPATION_GUEST_REMOVED",
    entity:   "Participation",
    entityId: participationId,
    label:    evenement.title,
    metadata: { memberName: `${participation.firstName} ${participation.lastName}` },
  })

  return new NextResponse(null, { status: 204 })
})
