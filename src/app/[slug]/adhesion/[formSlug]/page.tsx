import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
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
  return <MembershipFormPublicForm slug={slug} formSlug={formSlug} />
}
