import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { PublicActualitesListView } from "./public-actualites-list-view"

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const assoc = await prisma.association.findUnique({ where: { slug }, select: { name: true } })
  if (!assoc) return { title: "Actualités introuvables" }

  return { title: `Actualités — ${assoc.name}` }
}

export default async function PublicAssociationActualitesPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  return <PublicActualitesListView slug={slug} />
}
