import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { detectMembreDuplicates } from "@/lib/membre-duplicate-matches"
import { backofficeMembreDuplicatesScanRequestSchema } from "@/lib/schemas"

// Scans one chosen association at a time (via the picker on the backoffice page) — no bulk
// "scan every association" action in v1, same reasoning as there being no nightly cron: a
// staff member scans the one association they're actually investigating.
export const POST = withSuperAdminAuth(async (req) => {
  const parsed = backofficeMembreDuplicatesScanRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const association = await prisma.association.findUnique({ where: { id: parsed.data.associationId }, select: { id: true } })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const summary = await detectMembreDuplicates(association.id)
  return NextResponse.json(summary)
})
