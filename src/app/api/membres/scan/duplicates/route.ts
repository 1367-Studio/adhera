import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { paperFormDuplicatesRequestSchema, type PaperFormDuplicatesResponse } from "@/lib/schemas"
import { MANAGER_ROLES } from "@/lib/roles"
import { findPaperFormDuplicates } from "@/lib/paper-form/duplicates"

// Before the manager confirms a batch of scanned forms: which students look like members the
// association already has (parents are never members, so never checked). Read-only.
export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const body = await req.json().catch(() => null)
  const parsed = paperFormDuplicatesRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const response: PaperFormDuplicatesResponse = {
    matches: await findPaperFormDuplicates(associationId, parsed.data.people),
  }
  return NextResponse.json(response)
}, { roles: MANAGER_ROLES })
