import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { mergeMembershipTiers, MergeMembershipTiersError } from "@/lib/membership-tier-merge"

const mergeRequestSchema = z.object({
  primaryTierId:   z.string().min(1),
  secondaryTierId: z.string().min(1),
})

export const POST = withAdminAuth(async (req, ctx) => {
  const parsed = mergeRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  try {
    const result = await mergeMembershipTiers({
      associationId: ctx.associationId,
      performedById: ctx.userId,
      ...parsed.data,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof MergeMembershipTiersError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}, { area: "adhesions", access: "edit", module: "cotisations" })
