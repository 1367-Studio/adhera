import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { computeMemberDiff, writeActivityLog } from "@/lib/activity-log"

type SessionUser = { id?: string; associationId?: string | null }

const phoneRegex = /^[+\d][\d\s.\-()]{5,19}$/

const updateSchema = z.object({
  phone:     z.string().trim().optional().or(z.literal("")).refine(
    v => !v || phoneRegex.test(v),
    "Numéro de téléphone invalide",
  ),
  address:   z.string().trim().optional().or(z.literal("")),
  birthDate: z.string().optional().or(z.literal("")).refine(
    v => !v || new Date(v) < new Date(),
    "La date de naissance doit être dans le passé",
  ),
})

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await prisma.membre.findFirst({
    where: { userId: u.id!, associationId: u.associationId, deletedAt: null },
  })
  if (!membre) return NextResponse.json({ error: "Profil introuvable" }, { status: 404 })
  return NextResponse.json(membre)
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await prisma.membre.findFirst({ where: { userId: u.id!, associationId: u.associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Profil introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { phone, address, birthDate } = parsed.data
  const updated = await prisma.membre.update({
    where: { id: membre.id },
    data: {
      ...(phone     !== undefined ? { phone:     phone     || null } : {}),
      ...(address   !== undefined ? { address:   address   || null } : {}),
      ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null } : {}),
    },
  })

  const changes = computeMemberDiff(
    membre  as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
  )
  if (Object.keys(changes).length > 0) {
    await writeActivityLog({
      associationId: u.associationId!,
      actorId:  u.id,
      action:   "PROFIL_UPDATED",
      entity:   "Membre",
      entityId: membre.id,
      label:    `${membre.firstName} ${membre.lastName}`,
      metadata: { changes },
    })
  }

  return NextResponse.json(updated)
}
