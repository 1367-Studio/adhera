import { NextResponse }  from "next/server"
import { prisma }        from "@/lib/prisma/client"
import { z }             from "zod"
import { withSuperAdminAuth } from "@/lib/api-wrapper"

const patchSchema = z.object({
  internalNotes: z.string().optional(),
  modules: z.object({
    evenements:  z.boolean(),
    cotisations: z.boolean(),
    actualites:  z.boolean(),
    messages:    z.boolean(),
    materiel:    z.boolean(),
    site:        z.boolean(),
    ia:          z.boolean(),
    dons:        z.boolean(),
    sondages:    z.boolean(),
    boutique:    z.boolean(),
    reunions:    z.boolean(),
    sms:         z.boolean(),
    finances:    z.boolean(),
  }).optional(),
})

export const PATCH = withSuperAdminAuth<{ id: string }>(async (req, _ctx, { id }) => {
  const body   = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  }

  const data = parsed.data
  const update: Record<string, unknown> = {}
  if (data.internalNotes !== undefined) update.internalNotes = data.internalNotes
  if (data.modules       !== undefined) update.modules       = data.modules

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 })
  }

  try {
    const existing = await prisma.association.findUnique({
      where:  { id },
      select: { deletedAt: true },
    })
    if (!existing || existing.deletedAt !== null) {
      return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
    }
    await prisma.association.update({ where: { id }, data: update })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 })
  }
})
