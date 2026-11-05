import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { connectAccountChargesEnabled } from "@/lib/stripe"
import { reportError } from "@/lib/monitoring"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { translateFields } from "@/lib/i18n/translate"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true, stripeConnectId: true, sitePublished: true, website: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.boutique) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const produits = await prisma.boutiqueProduit.findMany({
    where:   { associationId: assoc.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      variantes: {
        orderBy: { createdAt: "asc" },
        select:  { id: true, label: true, price: true, stock: true },
      },
    },
  })

  // Drives whether the storefront even offers "pay online" — without this, a visitor could
  // fill the whole cart + guest form and only discover Stripe isn't configured after
  // clicking submit, same gap the public donation form already avoids via its own
  // `paymentEnabled` flag (see /api/public/[slug]/dons/[formSlug]/route.ts).
  let paymentEnabled = false
  if (assoc.stripeConnectId) {
    try {
      paymentEnabled = await connectAccountChargesEnabled(assoc.stripeConnectId)
    } catch (err) {
      reportError(err, { area: "stripe", action: "public.boutique.payment-availability", extra: { associationId: assoc.id } })
    }
  }

  // Whether "Voltar ao site" (the public homepage) actually resolves — getSiteData() requires
  // both sitePublished AND the "site" module, so a boutique can be live with neither.
  const sitePublished = assoc.sitePublished && modules.site

  // The admin always writes this content in their own language — translateFields translates it
  // automatically whenever the visitor's resolved locale isn't French (no-ops for French), same
  // policy as every other public form route. translateFields only maps the top-level string
  // keys it's given — it doesn't recurse into nested arrays — so variante labels need their own
  // batched call across every product, same pattern as ticket-type labels in
  // enrichPortalEvenements (src/lib/portal-evenements.ts).
  const locale = await resolvePublicLocale()
  const translatedProduits   = await translateFields(produits, ["name", "description"], locale, assoc.id)
  const flatVariantes        = produits.flatMap(produit => produit.variantes)
  const translatedVariantes  = await translateFields(flatVariantes, ["label"], locale, assoc.id)
  const translatedLabelById  = new Map(translatedVariantes.map(variante => [variante.id, variante.label]))
  const translated = translatedProduits.map((produit, i) => ({
    ...produit,
    variantes: produits[i].variantes.map(variante => ({ ...variante, label: translatedLabelById.get(variante.id) ?? variante.label })),
  }))

  return NextResponse.json({ associationName: assoc.name, produits: translated, paymentEnabled, sitePublished, website: assoc.website })
}
