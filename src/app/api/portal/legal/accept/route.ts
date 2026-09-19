import { NextResponse } from "next/server"
import { z } from "zod"
import { withPortalAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { consentIp } from "@/lib/consent"
import {
  LegalConsentError, pendingLegalDocuments, recordAcceptances, resolveAcceptedRevisions,
} from "@/lib/legal/acceptance"

const schema = z.object({
  acceptedLegalRevisionIds: z.array(z.string().min(1)).max(20),
})

// A member agreeing again after the association rewrote a document it requires — the gate that
// the portal layout puts in front of everything else until this succeeds.
//
// Checked against what is still *pending for this member*, not against the full required list:
// someone who already agreed to two of three documents only has the third left to sign, and
// re-sending the two would otherwise be rejected as an incomplete set.
export const POST = withPortalAuth(async (req, ctx) => {
  const { associationId, userId, membreId } = ctx

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  const pending = await pendingLegalDocuments(associationId, { userId, membreId, email: user?.email })
  if (pending.length === 0) return NextResponse.json({ ok: true })

  try {
    const revisionIds = resolveAcceptedRevisions(pending, parsed.data.acceptedLegalRevisionIds)
    await recordAcceptances({
      associationId,
      revisionIds,
      identity: { userId, membreId },
      context:  "PORTAL_REACCEPTANCE",
      ip:       consentIp(req),
    })
  } catch (error) {
    if (error instanceof LegalConsentError) return NextResponse.json({ error: error.message }, { status: 422 })
    throw error
  }

  return NextResponse.json({ ok: true })
}, { requireMembre: false })
