import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { PublicDocumentsListView } from "./public-documents-list-view"

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const assoc = await prisma.association.findUnique({ where: { slug }, select: { name: true } })
  if (!assoc) return { title: "Documents introuvables" }

  // noindex: these are an association's own terms, reachable by anyone holding the link (and
  // linked from its forms), but they have no business ranking as standalone search results.
  return {
    title:   `Documents légaux — ${assoc.name}`,
    robots:  { index: false, follow: false },
  }
}

export default async function PublicAssociationDocumentsPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  return <PublicDocumentsListView slug={slug} />
}
