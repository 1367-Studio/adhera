import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { BoutiqueStorefrontListing } from "./boutique-storefront-listing"

async function getAssocMeta(slug: string) {
  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { name: true, modules: true, logoUrl: true },
  })
  if (!assoc || !parseModules(assoc.modules).boutique) return null
  return assoc
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const assoc = await getAssocMeta(slug)
  if (!assoc) return { title: "Boutique introuvable" }

  const title = `Boutique — ${assoc.name}`
  return {
    title,
    description: `Découvrez les produits proposés par ${assoc.name}.`,
    openGraph: {
      title,
      type:   "website",
      images: assoc.logoUrl ? [{ url: assoc.logoUrl }] : undefined,
    },
  }
}

export default async function PublicBoutiquePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  return <BoutiqueStorefrontListing slug={slug} />
}
