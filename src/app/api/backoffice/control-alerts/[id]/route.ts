import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { controlAlertInclude } from "../route"

const patchSchema = z.object({
  status: z.enum(["OUVERT", "RESOLU"]),
  note:   z.string().optional(),
})

// Resolve (with an optional note) or reopen — a "Résoudre" clicked by mistake, or a note that
// turns out to need correcting, had no way back except editing the database directly.
// Reopening clears resolvedAt/resolvedById/autoResolved/note: those all describe the
// resolution that no longer holds, not the member. The sweep's `controlAlert: null` filter
// still never re-raises this automatically — reopening is a deliberate human action, not the
// sweep changing its mind.
export const PATCH = withSuperAdminAuth<{ id: string }>(async (req, { userId }, { id }) => {
  const existing = await prisma.membreControlAlert.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Alerte introuvable" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const data = parsed.data.status === "RESOLU"
    ? { status: "RESOLU" as const, resolvedAt: new Date(), resolvedById: userId, autoResolved: false, note: parsed.data.note }
    : { status: "OUVERT" as const, resolvedAt: null,        resolvedById: null,  autoResolved: false, note: null }

  const alert = await prisma.membreControlAlert.update({ where: { id }, data, include: controlAlertInclude })
  return NextResponse.json(alert)
})
