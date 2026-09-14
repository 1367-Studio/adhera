import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { translateFields } from "@/lib/i18n/translate"
import { canPreviewForm } from "@/lib/form-preview"
import type { Locale } from "@/i18n/locales"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, sitePublished: true, siteConfig: true, modules: true },
  })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const mods = parseModules(assoc.modules)
  if (!mods.site || !mods.actualites) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Sent back even on a 404 below so the client can still render the site's nav/footer around
  // a "not found" message instead of stranding the visitor on a bare page with no way to reach
  // the rest of the site.
  const site = { name: assoc.name, config: assoc.siteConfig }

  // `?preview=1` lets a logged-in manager open a DRAFT / not-yet-due / SELECTED-recipient post
  // exactly as it'll look once published — same convention as the adhesion/donation/evenements
  // public routes' "Aperçu" button.
  const preview = await canPreviewForm(req, assoc.id)

  const now = new Date()
  const actualite = await prisma.actualite.findFirst({
    where: {
      id, associationId: assoc.id,
      ...(preview ? {} : {
        publishedAt: { not: null, lte: now },
        // Anonymous visitors can never be an authorized SELECTED recipient — same gate as the
        // site's list query in src/app/[slug]/page.tsx.
        recipientMode: "ALL",
      }),
    },
    select: {
      id: true, title: true, content: true, imageUrl: true, pinned: true, publishedAt: true,
      evenement: { select: { id: true, title: true, date: true, status: true, visibility: true } },
    },
  })
  if (!actualite) return NextResponse.json({ error: "Not found", site }, { status: 404 })

  // The admin always writes this content in their own language — translate it for visitors
  // on the fly (cached per locale), same pattern as the evenements public detail route.
  const locale = (await getLocale()) as Locale
  const [translated] = await translateFields(
    [{ title: actualite.title, content: actualite.content }],
    ["title", "content"],
    locale,
    assoc.id,
  )

  // Don't link to an event that's since gone back to DRAFT or PRIVATE — same visibility gate
  // as the public events list, otherwise the "related event" card leads to a dead 404.
  const evenement = actualite.evenement && actualite.evenement.status === "PUBLISHED" && actualite.evenement.visibility !== "PRIVATE"
    ? { id: actualite.evenement.id, title: actualite.evenement.title, date: actualite.evenement.date }
    : null

  return NextResponse.json({
    actualite: { ...actualite, title: translated.title, content: translated.content, evenement },
    site,
    previewMode: preview,
  })
}
