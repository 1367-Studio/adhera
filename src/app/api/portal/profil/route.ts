import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { computeMemberDiff, writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

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
  civilite:      z.enum(["MME", "MLLE", "M"]).optional().or(z.literal("")),
  groupeSanguin: z.enum([
    "A_POSITIF", "A_NEGATIF",
    "B_POSITIF", "B_NEGATIF",
    "AB_POSITIF", "AB_NEGATIF",
    "O_POSITIF", "O_NEGATIF",
  ]).optional().or(z.literal("")),
  allergies: z.string().trim().optional().or(z.literal("")),
  photoUrl:  z.string().trim().optional().or(z.literal("")),
  possedeTshirt: z.enum(["true", "false"]).optional().or(z.literal("")),
  tailleTshirt:  z.enum(["XS", "S", "M", "L", "XL", "XXL", "XXXL"]).optional().or(z.literal("")),
})

export const GET = withPortalAuth(async (_req, ctx) => {
  const membre = await prisma.membre.findUnique({ where: { id: ctx.membreId! } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
  return NextResponse.json(membre)
})

export const PATCH = withPortalAuth(async (req, ctx) => {
  const membre = await prisma.membre.findUnique({ where: { id: ctx.membreId! } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { phone, address, birthDate, civilite, groupeSanguin, allergies, photoUrl, possedeTshirt, tailleTshirt, ...rest } = parsed.data

  // Server-side backstop for the client's reactive clear (profil/page.tsx): never persist
  // "does not have a t-shirt" alongside a size, regardless of what the request body says.
  const possedeTshirtValue = possedeTshirt === undefined ? undefined : (possedeTshirt === "" ? null : possedeTshirt === "true")
  const tailleTshirtValue  = possedeTshirtValue === false ? null : (tailleTshirt === undefined ? undefined : (tailleTshirt || null))

  const updated = await prisma.membre.update({
    where: { id: membre.id },
    data: {
      ...rest,
      ...(phone     !== undefined ? { phone:     phone     || null } : {}),
      ...(address   !== undefined ? { address:   address   || null } : {}),
      ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null } : {}),
      ...(civilite      !== undefined ? { civilite:      civilite      || null } : {}),
      ...(groupeSanguin !== undefined ? { groupeSanguin: groupeSanguin || null } : {}),
      ...(allergies     !== undefined ? { allergies:     allergies     || null } : {}),
      ...(photoUrl      !== undefined ? { photoUrl:      photoUrl      || null } : {}),
      ...(possedeTshirtValue !== undefined ? { possedeTshirt: possedeTshirtValue } : {}),
      ...(tailleTshirtValue  !== undefined ? { tailleTshirt:  tailleTshirtValue  } : {}),
    },
  })

  const changes = computeMemberDiff(
    membre  as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
  )
  if (Object.keys(changes).length > 0) {
    await writeActivityLog({
      associationId: ctx.associationId,
      actorId:  ctx.userId,
      action:   "PROFIL_UPDATED",
      entity:   "Membre",
      entityId: membre.id,
      label:    `${membre.firstName} ${membre.lastName}`,
      metadata: { changes },
    })
  }

  return NextResponse.json(updated)
})
