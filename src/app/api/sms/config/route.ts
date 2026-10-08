import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { encryptNullable } from "@/lib/crypto/field-encryption"

const schema = z.object({
  smsAccountSid:  z.string().max(256).nullable().optional(),
  smsAuthToken:   z.string().max(256).nullable().optional(),
  smsPhoneNumber: z.string().max(32).nullable().optional(),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { smsAccountSid: true, smsPhoneNumber: true, smsAuthToken: true },
  })

  return NextResponse.json({
    smsPhoneNumber:  assoc?.smsPhoneNumber ?? null,
    smsConfigured:   !!(assoc?.smsAccountSid && assoc?.smsAuthToken && assoc?.smsPhoneNumber),
  })
})

// Credentials of the association: administrators only (président/admin, as before).
export const PATCH = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { smsAccountSid, smsAuthToken, smsPhoneNumber } = parsed.data

  const updated = await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      ...(smsAccountSid  !== undefined ? { smsAccountSid:  encryptNullable(smsAccountSid) ?? null } : {}),
      ...(smsAuthToken   !== undefined ? { smsAuthToken:   encryptNullable(smsAuthToken)  ?? null } : {}),
      ...(smsPhoneNumber !== undefined ? { smsPhoneNumber: smsPhoneNumber ?? null } : {}),
    },
    select: { smsAccountSid: true, smsAuthToken: true, smsPhoneNumber: true },
  })

  // Field names only, never the values — smsAuthToken/smsAccountSid are credentials and
  // must never land in a log any manager on the association can read.
  const fieldsChanged = [
    smsAccountSid  !== undefined && "smsAccountSid",
    smsAuthToken   !== undefined && "smsAuthToken",
    smsPhoneNumber !== undefined && "smsPhoneNumber",
  ].filter(Boolean)
  if (fieldsChanged.length > 0) {
    await writeActivityLog({
      associationId: ctx.associationId, actorId: ctx.userId, action: "SMS_SETTINGS_UPDATED",
      entity: "Association", entityId: ctx.associationId, metadata: { fieldsChanged },
    })
  }

  return NextResponse.json({
    ok:            true,
    smsConfigured: !!(updated.smsAccountSid && updated.smsAuthToken && updated.smsPhoneNumber),
  })
}, { administrator: true })
