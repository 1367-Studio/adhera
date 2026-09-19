import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { PublicDocumentDetailView } from "./public-document-detail-view"

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Metadata> {
  const { slug, id } = await params
  const document = await prisma.associationDocument.findFirst({
    where:  { id, association: { slug }, deletedAt: null, visibleToPublic: true },
    select: { title: true, association: { select: { name: true } } },
  })
  if (!document) return { title: "Document introuvable" }

  // noindex for the same reason as the list page.
  return {
    title:  `${document.title} — ${document.association.name}`,
    robots: { index: false, follow: false },
  }
}

export default async function PublicAssociationDocumentPage(
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params
  return <PublicDocumentDetailView slug={slug} id={id} />
}
