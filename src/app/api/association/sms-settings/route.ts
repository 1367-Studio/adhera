import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { parseSmsSettings } from "@/lib/sms-settings"

const ADMINS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  rsvpConfirmation: z.boolean(),
  eventReminder:    z.boolean(),
  memberWelcome:    z.boolean(),
})

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { smsSettings: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(parseSmsSettings(assoc.smsSettings))
}

export async function PATCH(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  if (!ADMINS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { smsSettings: parsed.data },
  })

  return NextResponse.json({ ok: true })
}
