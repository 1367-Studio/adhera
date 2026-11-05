import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { translateSiteUiStrings } from "@/lib/site-puck/site-ui-strings-translate"
import { PublicActualitesListView } from "./public-actualites-list-view"

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const assoc = await prisma.association.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!assoc) return { title: "Actualités introuvables" }

  // Crawlers/link-preview bots never click a language switcher — same always-by-locale policy
  // as the detail page's own metadata.
  const locale = await resolvePublicLocale()
  const ui     = await translateSiteUiStrings(locale, assoc.id)
  return { title: `${ui.actualitesDefaultTitle} — ${assoc.name}` }
}

export default async function PublicAssociationActualitesPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  return <PublicActualitesListView slug={slug} />
}
