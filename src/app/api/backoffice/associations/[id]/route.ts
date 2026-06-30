import { NextResponse }  from "next/server"
import { auth }          from "@/lib/auth/config"
import { prisma }        from "@/lib/prisma/client"
import { z }             from "zod"
import type { SessionUser } from "@/lib/user-context"

const patchSchema = z.object({
  internalNotes: z.string().optional(),
  modules: z.object({
    evenements:  z.boolean(),
    cotisations: z.boolean(),
    tresorerie:  z.boolean(),
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
  }).optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  const user    = session?.user as SessionUser | undefined
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }

  const { id } = await params
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
}
