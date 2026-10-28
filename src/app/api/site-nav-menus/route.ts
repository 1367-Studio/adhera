import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { MAX_SITE_NAV_MENUS, normalizedSiteNavMenuLabel } from "@/lib/site-puck/site-nav-menu"

// FORM-7 "Pages" nav menus: named dropdowns (e.g. "À propos", "Ressources") an association
// creates to group several custom pages instead of giving each its own header button — see the
// SiteNavMenu model's comment in schema.prisma and src/lib/site-puck/site-page-nav.ts.

const MAX_LABEL_LENGTH = 60

const createSiteNavMenuSchema = z.object({
  label: z.string().trim().min(1, "Le nom du menu est obligatoire").max(MAX_LABEL_LENGTH, "Le nom du menu est trop long"),
})

export const GET = withAdminAuth(async (_req, ctx) => {
  const siteNavMenus = await prisma.siteNavMenu.findMany({
    where:   { associationId: ctx.associationId },
    orderBy: { position: "asc" },
    select:  { id: true, label: true, position: true },
  })
  return NextResponse.json({ siteNavMenus })
}, { area: "site", module: "site" })

export const POST = withAdminAuth(async (req, ctx) => {
  const parsedBody = createSiteNavMenuSchema.safeParse(await req.json().catch(() => null))
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Corps de requête invalide" }, { status: 422 })
  }

  const existingSiteNavMenus = await prisma.siteNavMenu.findMany({
    where:   { associationId: ctx.associationId },
    orderBy: { position: "desc" },
    select:  { label: true, position: true },
  })

  if (existingSiteNavMenus.length >= MAX_SITE_NAV_MENUS) {
    return NextResponse.json({ error: `Vous avez atteint la limite de ${MAX_SITE_NAV_MENUS} menus.` }, { status: 422 })
  }

  const newLabel = parsedBody.data.label
  if (existingSiteNavMenus.some(menu => normalizedSiteNavMenuLabel(menu.label) === normalizedSiteNavMenuLabel(newLabel))) {
    return NextResponse.json({ error: "Un menu avec ce nom existe déjà." }, { status: 409 })
  }

  // New menu always goes last — reordering afterwards uses the same up/down pattern as
  // SitePage.navPosition (see site-pages-view.tsx).
  const siteNavMenu = await prisma.siteNavMenu.create({
    data: {
      associationId: ctx.associationId,
      label:         newLabel,
      position:      (existingSiteNavMenus[0]?.position ?? -1) + 1,
    },
    select: { id: true, label: true, position: true },
  })

  return NextResponse.json({ siteNavMenu }, { status: 201 })
}, { area: "site", module: "site" })
