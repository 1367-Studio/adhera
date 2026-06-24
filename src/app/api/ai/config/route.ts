import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  aiApiKey: z.string().max(256).nullable().optional(),
  aiModel:  z.string().max(128).nullable().optional(),
})

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { aiApiKey: true, aiModel: true },
  })

  return NextResponse.json({
    aiModel:            assoc?.aiModel    ?? null,
    aiApiKeyConfigured: !!assoc?.aiApiKey,
    usingPlatformKey:   !assoc?.aiApiKey && !!process.env.GROQ_API_KEY,
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

  const { aiApiKey, aiModel } = parsed.data

  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      aiModel: aiModel !== undefined ? aiModel : undefined,
      ...(aiApiKey !== undefined ? { aiApiKey: aiApiKey ?? null } : {}),
    },
  })

  return NextResponse.json({ ok: true })
}
