import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  smsAccountSid:  z.string().max(256).nullable().optional(),
  smsAuthToken:   z.string().max(256).nullable().optional(),
  smsPhoneNumber: z.string().max(32).nullable().optional(),
})

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { smsAccountSid: true, smsPhoneNumber: true, smsAuthToken: true },
  })

  return NextResponse.json({
    smsPhoneNumber:  assoc?.smsPhoneNumber ?? null,
    smsConfigured:   !!(assoc?.smsAccountSid && assoc?.smsAuthToken && assoc?.smsPhoneNumber),
  })
}

export async function PATCH(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { smsAccountSid, smsAuthToken, smsPhoneNumber } = parsed.data

  const updated = await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      ...(smsAccountSid  !== undefined ? { smsAccountSid:  smsAccountSid  ?? null } : {}),
      ...(smsAuthToken   !== undefined ? { smsAuthToken:   smsAuthToken   ?? null } : {}),
      ...(smsPhoneNumber !== undefined ? { smsPhoneNumber: smsPhoneNumber ?? null } : {}),
    },
    select: { smsAccountSid: true, smsAuthToken: true, smsPhoneNumber: true },
  })

  return NextResponse.json({
    ok:            true,
    smsConfigured: !!(updated.smsAccountSid && updated.smsAuthToken && updated.smsPhoneNumber),
  })
}
