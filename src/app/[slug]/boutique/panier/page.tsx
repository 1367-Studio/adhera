import { prisma } from "@/lib/prisma/client"
import { requiredDocuments } from "@/lib/legal/acceptance"
import { BoutiquePanierView } from "./boutique-panier-view"

export default async function PublicBoutiquePanierPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  // Read here rather than fetched by the cart: the consent box is then part of the very first
  // render, so a failed request can never quietly produce a checkout without it. An unknown
  // slug falls through to an empty list — the cart underneath renders its own states.
  const association = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
  const legalDocuments = association ? await requiredDocuments(association.id) : []

  return <BoutiquePanierView legalDocuments={legalDocuments} />
}
