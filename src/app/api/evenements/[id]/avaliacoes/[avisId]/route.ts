import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

type Params = { id: string; avisId: string }

const bodySchema = z.object({
  featuredOnSite: z.boolean(),
})

// Toggles whether one review is selected for display on the site — the only thing this route
// changes. An admin can never feature a review that was never consented to (publicationAgreedAt
// null), matching the public /avis/[token] consent flow.
export const PATCH = withAdminAuth<Params>(async (req, ctx, { id: evenementId, avisId }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const avis = await prisma.evenementAvis.findFirst({ where: { id: avisId, evenementId } })
  if (!avis) return NextResponse.json({ error: "Avis introuvable" }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { featuredOnSite } = parsed.data

  if (featuredOnSite && !avis.publicationAgreedAt)
    return NextResponse.json({ error: "Cet avis n'a pas reçu l'autorisation de publication du participant." }, { status: 422 })

  const updated = await prisma.evenementAvis.update({
    where: { id: avisId },
    data:  { featuredOnSite },
  })

  return NextResponse.json({ id: updated.id, featuredOnSite: updated.featuredOnSite })
}, { area: "evenements" })
