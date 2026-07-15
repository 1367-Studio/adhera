import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { canUseCustomBranding } from "@/lib/plan-limits"
import { deleteFromR2 } from "@/lib/r2"

const ADMINS = ["ADMIN", "PRESIDENT"]

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

// logoUrl is only ever supposed to come from our own /api/upload → R2 flow (see
// ImageUpload), but this is a raw JSON PATCH endpoint — without this check, an admin
// could point it at an arbitrary host and turn buildDocumentPdf()'s server-side fetch()
// (and the /api/association/branding/logo proxy) into an SSRF primitive. Compares the
// full origin, not a string prefix, so "https://<bucket>.r2.dev.evil.com" can't sneak by.
function isAllowedLogoUrl(url: string): boolean {
  const allowedBase = process.env.R2_PUBLIC_URL
  if (!allowedBase) return false
  try {
    return new URL(url).origin === new URL(allowedBase).origin
  } catch {
    return false
  }
}

const schema = z.object({
  logoUrl: z.string().trim().url().max(500)
    .refine(isAllowedLogoUrl, "URL de logo non autorisée")
    .optional().or(z.literal("")),
  primaryColor:   z.string().regex(HEX_COLOR, "Couleur invalide (format #RRGGBB)").optional(),
  secondaryColor: z.string().regex(HEX_COLOR, "Couleur invalide (format #RRGGBB)").optional().or(z.literal("")),
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canUseCustomBranding(association))
    return NextResponse.json({ error: "Personnalisation de marque réservée à la formule Pro" }, { status: 403 })

  const { logoUrl, primaryColor, secondaryColor } = parsed.data
  const previousLogoUrl = association.logoUrl

  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      ...(logoUrl        !== undefined ? { logoUrl:        logoUrl || null }        : {}),
      ...(primaryColor   !== undefined ? { primaryColor }                           : {}),
      ...(secondaryColor !== undefined ? { secondaryColor: secondaryColor || null } : {}),
    },
  })

  // Replaced or removed — the old file in R2 is now unreferenced anywhere, clean it up
  // rather than leaving it stored forever. Fire-and-forget: deleteFromR2() already
  // swallows its own errors, and the user shouldn't wait on this to see their save succeed.
  if (logoUrl !== undefined && previousLogoUrl && previousLogoUrl !== logoUrl) {
    deleteFromR2(previousLogoUrl)
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    label:         "Identité visuelle",
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS })
