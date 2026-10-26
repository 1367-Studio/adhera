import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"
import { normalizedSiteNavMenuLabel } from "@/lib/site-puck/site-nav-menu"

type RouteParams = { id: string }

const updateSiteNavMenuSchema = z.object({
  label:    z.string().trim().min(1, "Le nom du menu est obligatoire").max(60, "Le nom du menu est trop long").optional(),
  position: z.number().int().optional(),
})

export const PUT = withAdminAuth<RouteParams>(async (req, ctx, { id }) => {
  const parsedBody = updateSiteNavMenuSchema.safeParse(await req.json().catch(() => null))
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Corps de requête invalide" }, { status: 422 })
  }

  const existingSiteNavMenu = await prisma.siteNavMenu.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!existingSiteNavMenu) return NextResponse.json({ error: "Menu introuvable" }, { status: 404 })

  const { label, position } = parsedBody.data

  if (label !== undefined && normalizedSiteNavMenuLabel(label) !== normalizedSiteNavMenuLabel(existingSiteNavMenu.label)) {
    const otherSiteNavMenus = await prisma.siteNavMenu.findMany({
      where:  { associationId: ctx.associationId, id: { not: id } },
      select: { label: true },
    })
    if (otherSiteNavMenus.some(menu => normalizedSiteNavMenuLabel(menu.label) === normalizedSiteNavMenuLabel(label))) {
      return NextResponse.json({ error: "Un menu avec ce nom existe déjà." }, { status: 409 })
    }
  }

  const siteNavMenu = await prisma.siteNavMenu.update({
    where:  { id },
    data:   {
      ...(label !== undefined    ? { label }    : {}),
      ...(position !== undefined ? { position } : {}),
    },
    select: { id: true, label: true, position: true },
  })

  // A renamed menu's trigger text, or two menus swapping position, both change what visitors
  // see in the header immediately — same as a page's own nav placement (see
  // /api/site-pages/[id]'s PUT handler) — so neither waits for the next unrelated revalidation.
  if (label !== undefined || position !== undefined) await revalidatePublicSiteFor(ctx.associationId)

  return NextResponse.json({ siteNavMenu })
}, { area: "site", module: "site" })

export const DELETE = withAdminAuth<RouteParams>(async (_req, ctx, { id }) => {
  const existingSiteNavMenu = await prisma.siteNavMenu.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!existingSiteNavMenu) return NextResponse.json({ error: "Menu introuvable" }, { status: 404 })

  // Pages inside fall back to their own header button (SitePage.navMenuId → null via the FK's
  // ON DELETE SET NULL) rather than being removed from the nav.
  await prisma.siteNavMenu.delete({ where: { id } })
  await revalidatePublicSiteFor(ctx.associationId)

  return NextResponse.json({ ok: true })
}, { area: "site", module: "site" })
