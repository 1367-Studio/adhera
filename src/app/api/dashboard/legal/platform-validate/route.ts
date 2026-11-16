import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { consentIp } from "@/lib/consent"
import {
  PlatformLegalValidationError, pendingPlatformValidations, recordPlatformValidation,
  resolvePlatformConfirmations,
} from "@/lib/legal/platform-validation"

const schema = z.object({
  confirmed: z.array(z.object({
    slug:    z.enum(["CGU", "CGV", "DPA", "PRIVACY_POLICY", "MENTIONS_LEGALES", "ASSOCIATION_AUTHORIZATION"]),
    version: z.number().int().positive(),
  })).max(10),
})

// FORM-113's mandatory pop-up gate, for the handful of accounts with requiresLegalValidation
// set — see src/app/dashboard/layout.tsx. The six boxes are submitted and recorded together:
// the button that triggers this is only enabled once all six are checked, so a partial
// payload here is always a bug or a stale page, never a legitimate "accept three of six".
export const POST = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const pending = await pendingPlatformValidations(ctx.userId)
  if (pending.length === 0) return NextResponse.json({ ok: true })

  try {
    const confirmed = resolvePlatformConfirmations(pending, parsed.data.confirmed)
    await recordPlatformValidation({
      userId:        ctx.userId,
      associationId: ctx.associationId,
      confirmed,
      ip:            consentIp(req),
    })
  } catch (error) {
    if (error instanceof PlatformLegalValidationError) return NextResponse.json({ error: error.message }, { status: 422 })
    throw error
  }

  return NextResponse.json({ ok: true })
})
