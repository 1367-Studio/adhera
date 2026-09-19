import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { requiredDocuments } from "@/lib/legal/acceptance"
import { MembershipFormPublicForm } from "./membership-form-public-form"

async function getFormMeta(slug: string, formSlug: string) {
  return prisma.membershipForm.findFirst({
    where:  { slug: formSlug, association: { slug }, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
    select: { title: true, description: true, imageUrl: true, association: { select: { name: true } } },
  })
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
): Promise<Metadata> {
  const { slug, formSlug } = await params
  const data = await getFormMeta(slug, formSlug)
  if (!data) return { title: "Formulaire introuvable" }

  const description = data.description
    ? data.description.replace(/<[^>]+>/g, "").slice(0, 200)
    : `Rejoignez ${data.association.name}.`
  const title = `${data.title} — ${data.association.name}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: data.imageUrl ? [{ url: data.imageUrl }] : undefined,
    },
  }
}

export default async function PublicMembershipFormPage(
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
) {
  const { slug, formSlug } = await params

  // Read here rather than fetched by the form: the consent box is then part of the very first
  // render, so a failed request can never quietly produce a form without it. An unknown slug
  // falls through to an empty list — the page underneath renders its own not-found state.
  const association = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
  const legalDocuments = association ? await requiredDocuments(association.id) : []

  return <MembershipFormPublicForm slug={slug} formSlug={formSlug} legalDocuments={legalDocuments} />
}
