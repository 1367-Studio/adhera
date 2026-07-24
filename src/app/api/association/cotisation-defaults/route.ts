import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

// Same role set as bank/route.ts — the treasurer owns cotisation pricing day-to-day.
const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const schema = z.object({
  cotisationDefaultAmount: z.number().positive("Montant invalide").nullable(),
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { cotisationDefaultAmount } = parsed.data
  const association = await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { cotisationDefaultAmount },
    select: { cotisationDefaultAmount: true },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    label:         "Montant de cotisation par défaut",
  })

  return NextResponse.json({ cotisationDefaultAmount: association.cotisationDefaultAmount })
}, { roles: FINANCE })
