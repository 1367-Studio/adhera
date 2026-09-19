import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { requiredDocuments } from "@/lib/legal/acceptance"

// The documents this association requires agreement to — dashboard side, so a manager filling a
// form on someone else's behalf can be shown exactly what they are attesting to having
// collected. The public equivalent is /api/public/[slug]/legal.
export const GET = withAdminAuth(async (_req, ctx) => {
  return NextResponse.json({ documents: await requiredDocuments(ctx.associationId) })
})
