import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: {
      id:           true,
      name:         true,
      slug:         true,
      city:         true,
      country:      true,
      sitePublished: true,
      siteConfig:   true,
      modules:      true,
      membreTypes:  { select: { id: true, name: true, color: true } },
    },
  })

  if (!assoc || !assoc.sitePublished || !parseModules(assoc.modules).site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const mods = parseModules(assoc.modules)

  const now = new Date()
  const [events, actualites] = await Promise.all([
    mods.evenements
      ? prisma.evenement.findMany({
          where:   { associationId: assoc.id, date: { gte: now } },
          orderBy: { date: "asc" },
          take:    20,
          select:  { id: true, title: true, date: true, endDate: true, location: true, description: true, price: true, capacity: true },
        })
      : Promise.resolve([]),
    mods.actualites
      ? prisma.actualite.findMany({
          where:   { associationId: assoc.id, publishedAt: { not: null, lte: now } },
          orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
          take:    20,
          select:  { id: true, title: true, content: true, imageUrl: true, pinned: true, publishedAt: true },
        })
      : Promise.resolve([]),
  ])

  return NextResponse.json({
    name:        assoc.name,
    slug:        assoc.slug,
    city:        assoc.city,
    country:     assoc.country,
    config:      assoc.siteConfig,
    membreTypes: assoc.membreTypes,
    events:      events.map(e => ({ ...e, price: e.price?.toString() ?? null })),
    actualites:  actualites.map(a => ({ ...a, publishedAt: a.publishedAt!.toISOString() })),
  })
}
