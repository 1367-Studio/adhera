import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  livekitUrl:       z.string().max(256).nullable().optional(),
  livekitApiKey:    z.string().max(256).nullable().optional(),
  livekitApiSecret: z.string().max(256).nullable().optional(),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { livekitUrl: true, livekitApiKey: true, livekitApiSecret: true },
  })

  return NextResponse.json({
    livekitUrl:        assoc?.livekitUrl ?? null,
    livekitConfigured: !!(assoc?.livekitUrl && assoc?.livekitApiKey && assoc?.livekitApiSecret),
    // Shown in the settings UI so admins know exactly what to paste into their own LiveKit
    // project's webhook config — without it, auto-close-if-left-running silently stops
    // working the moment they switch off the platform's shared account.
    webhookUrl: `${process.env.NEXTAUTH_URL ?? ""}/api/webhook/livekit`,
  })
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { livekitUrl, livekitApiKey, livekitApiSecret } = parsed.data

  const updated = await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      ...(livekitUrl       !== undefined ? { livekitUrl:       livekitUrl       ?? null } : {}),
      ...(livekitApiKey    !== undefined ? { livekitApiKey:    livekitApiKey    ?? null } : {}),
      ...(livekitApiSecret !== undefined ? { livekitApiSecret: livekitApiSecret ?? null } : {}),
    },
    select: { livekitUrl: true, livekitApiKey: true, livekitApiSecret: true },
  })

  return NextResponse.json({
    ok:                true,
    livekitConfigured: !!(updated.livekitUrl && updated.livekitApiKey && updated.livekitApiSecret),
  })
})
