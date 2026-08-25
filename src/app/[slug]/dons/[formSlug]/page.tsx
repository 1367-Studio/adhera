import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { DonationFormPublicForm } from "./donation-form-public-form"

async function getFormMeta(slug: string, formSlug: string) {
  return prisma.donationForm.findFirst({
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
    : `Faites un don à ${data.association.name}.`
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

export default async function PublicDonationFormPage(
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
) {
  const { slug, formSlug } = await params
  return <DonationFormPublicForm slug={slug} formSlug={formSlug} />
}
