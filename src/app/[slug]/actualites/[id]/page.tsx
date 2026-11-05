import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { translateFields } from "@/lib/i18n/translate"
import { ActualiteDetailView } from "./actualite-detail-view"

async function getActualiteMeta(slug: string, id: string) {
  return prisma.actualite.findFirst({
    where:  { id, association: { slug }, publishedAt: { not: null }, recipientMode: "ALL" },
    select: { title: true, content: true, imageUrl: true, associationId: true, association: { select: { name: true } } },
  })
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Metadata> {
  const { slug, id } = await params
  const data = await getActualiteMeta(slug, id)
  if (!data) return { title: "Actualité introuvable" }

  // Crawlers/link-preview bots never click a language switcher — the <title>/description they
  // see follows the visitor's resolved locale automatically, same as every other public page's
  // metadata (translateFields no-ops for French internally).
  const locale = await resolvePublicLocale()
  const [translated] = await translateFields(
    [{ title: data.title, content: data.content }],
    ["title", "content"],
    locale,
    data.associationId,
  )
  const description = translated.content.replace(/<[^>]+>/g, "").slice(0, 200)
  const title = `${translated.title} — ${data.association.name}`
  return { title, description, openGraph: { title, description, type: "website", images: data.imageUrl ? [{ url: data.imageUrl }] : undefined } }
}

export default async function PublicActualitePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  return <ActualiteDetailView slug={slug} id={id} />
}
