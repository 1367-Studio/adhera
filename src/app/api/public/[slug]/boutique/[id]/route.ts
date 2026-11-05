import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { translateFields } from "@/lib/i18n/translate"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, modules: true, sitePublished: true, website: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.boutique) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const produit = await prisma.boutiqueProduit.findFirst({
    where:   { id, associationId: assoc.id, status: "ACTIVE" },
    include: {
      variantes: {
        orderBy: { createdAt: "asc" },
        select:  { id: true, label: true, price: true, stock: true, shippable: true, weightGrams: true },
      },
    },
  })
  if (!produit) return NextResponse.json({ error: "Produit introuvable" }, { status: 404 })

  // Whether "Voltar ao site" (the public homepage) actually resolves — getSiteData() requires
  // both sitePublished AND the "site" module, so a boutique can be live with neither.
  const sitePublished = assoc.sitePublished && modules.site

  // The admin always writes this content in their own language — translateFields translates it
  // automatically whenever the visitor's resolved locale isn't French (no-ops for French), same
  // policy as every other public form route (e.g. dons/[formSlug]/route.ts).
  const locale = await resolvePublicLocale()
  const [translatedProduit] = await translateFields([produit], ["name", "description"], locale, assoc.id)
  const translatedVariantes = await translateFields(produit.variantes, ["label"], locale, assoc.id)

  return NextResponse.json({ ...translatedProduit, variantes: translatedVariantes, sitePublished, website: assoc.website })
}
