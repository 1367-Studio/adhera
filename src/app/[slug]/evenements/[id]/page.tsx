import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { evenementRefWhere } from "@/lib/slug"
import { requiredDocuments } from "@/lib/legal/acceptance"
import { EvenementRegisterForm } from "./evenement-register-form"

async function getEventMeta(slug: string, id: string) {
  return prisma.evenement.findFirst({
    where:  { ...evenementRefWhere(id), association: { slug } },
    select: { title: true, description: true, imageUrl: true, association: { select: { name: true } } },
  })
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Metadata> {
  const { slug, id } = await params
  const data = await getEventMeta(slug, id)
  if (!data) return { title: "Événement introuvable" }

  const description = data.description
    ? data.description.replace(/<[^>]+>/g, "").slice(0, 200)
    : `Inscrivez-vous à cet événement organisé par ${data.association.name}.`
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

export default async function PublicEvenementPage(
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  // Read here rather than fetched by the form: the consent box is then part of the very first
  // render, so a failed request can never quietly produce a form without it. An unknown slug
  // falls through to an empty list — the form underneath renders its own not-found state.
  const association = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
  const legalDocuments = association ? await requiredDocuments(association.id) : []

  return <EvenementRegisterForm slug={slug} id={id} legalDocuments={legalDocuments} />
}
