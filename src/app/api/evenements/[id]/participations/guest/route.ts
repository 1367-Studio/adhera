import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const bodySchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName:  z.string().min(1).max(80),
  email:     z.string().email().optional(),
})

// Lets the organizer add someone directly to the door list who never went through
// RSVP/checkout — a walk-in guest with no Membre record at all.
export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { firstName, lastName, email } = parsed.data

  if (evenement.capacity != null) {
    const occupied = await prisma.participation.count({ where: { evenementId, present: true } })
    if (occupied + 1 > evenement.capacity)
      return NextResponse.json({ error: "Capacité maximale atteinte" }, { status: 422 })
  }

  const participation = await prisma.participation.create({
    data: { evenementId, firstName, lastName, email: email ?? null, present: true },
  })

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "PRESENCE_MARKED",
    entity:   "Participation",
    entityId: participation.id,
    label:    evenement.title,
    metadata: { present: true, memberName: `${firstName} ${lastName}`, guest: true },
  })

  return NextResponse.json(participation, { status: 201 })
})
