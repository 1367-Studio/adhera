import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, status: true, title: true },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  if (sondage.status !== "ACTIF")
    return NextResponse.json({ error: "Seul un sondage actif peut être fermé" }, { status: 400 })

  await prisma.sondage.update({ where: { id }, data: { status: "FERME" } })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SONDAGE_CLOSED",
    entity:        "Sondage",
    entityId:      id,
    label:         sondage.title,
  })

  return NextResponse.json({ ok: true })
}
