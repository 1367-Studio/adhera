import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { translateFields } from "@/lib/i18n/translate"
import type { Locale } from "@/i18n/locales"
import { stripHtml } from "@/lib/utils"
import { withPortalAuth } from "@/lib/api-wrapper"

// Un aperçu de carte a besoin d'une coupure entre blocs (paragraphes, items de liste), pas
// juste d'un espace — sinon "Premier item"/"Second item" d'origine se lisent comme une seule
// phrase collée. stripHtml() garde son comportement plein-texte pour ses autres usages
// (validation, recherche) ; ceci est une version courte dédiée à l'aperçu de campagne.
function excerpt(html: string, maxLength = 140): string {
  const withBreaks = html.replace(/<\/(p|li|h[1-6]|div)>|<br\s*\/?>/gi, ". ")
  const text = stripHtml(withBreaks).replace(/(\.\s*){2,}/g, ". ").replace(/^[.\s]+/, "").trim()
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text
}

// Campagnes que le membre peut soutenir depuis Mon espace. Contrairement à la route
// publique (/api/public/[slug]/dons/[formSlug]), on n'exclut pas visibility: "PRIVATE" —
// pour les dons, comme pour les événements (voir /api/portal/evenements), PRIVATE signifie
// "réservé au portail", pas "caché de tout le monde". LINK et SITE restent visibles aussi :
// un formulaire publié est toujours visible à un membre authentifié, quelle que soit sa
// visibilité choisie pour le site public.
//
// opensAt/closesAt ne filtrent pas la requête : une campagne à venir ou tout juste terminée
// reste listée (avec son propre badge, voir notOpenYet/closed) plutôt que de disparaître sans
// laisser de trace — même logique que la page de détail, qui affiche déjà ces états.
export const GET = withPortalAuth(async (_req, ctx) => {
  const forms = await prisma.donationForm.findMany({
    where:   { associationId: ctx.associationId, status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    select:  { id: true, slug: true, title: true, description: true, imageUrl: true, opensAt: true, closesAt: true },
  })

  const locale     = (await getLocale()) as Locale
  const translated = await translateFields(forms, ["title", "description"], locale, ctx.associationId)

  const now = new Date()
  return NextResponse.json(
    translated.map(f => ({
      id:          f.id,
      slug:        f.slug,
      title:       f.title,
      description: f.description ? excerpt(f.description) : null,
      imageUrl:    f.imageUrl,
      notOpenYet:  !!f.opensAt && f.opensAt > now,
      closed:      !!f.closesAt && f.closesAt < now,
    })),
  )
}, { module: "dons" })
