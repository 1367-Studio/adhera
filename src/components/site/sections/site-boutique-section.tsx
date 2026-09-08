import Link from "next/link"
import type { BoutiqueSection } from "@/types/site-config"

type PublicVariante = { price: number }
type PublicProduit = {
  id:        string
  name:      string
  imageUrl:  string | null
  variantes: PublicVariante[]
}

type Props = {
  section:  BoutiqueSection
  produits: PublicProduit[]
  color:    string
  slug:     string
}

export function SiteBoutiqueSection({ section, produits, color, slug }: Props) {
  const displayed = produits.slice(0, section.limit ?? 6)
  const fmt = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">{section.title || "Boutique"}</h2>
          <Link href={`/${slug}/boutique`} className="text-sm font-medium hover:underline" style={{ color }}>
            Voir la boutique →
          </Link>
        </div>

        {displayed.length === 0 ? (
          <p className="text-gray-500">Aucun produit disponible pour le moment.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayed.map(p => {
              const prices = p.variantes.map(v => v.price)
              const min = prices.length ? Math.min(...prices) : 0
              const max = prices.length ? Math.max(...prices) : 0

              return (
                <Link
                  key={p.id}
                  href={`/${slug}/boutique/${p.id}`}
                  className="rounded-lg border border-gray-100 overflow-hidden transition-shadow block"
                >
                  {p.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="w-full h-44 object-cover"
                    />
                  )}
                  <div className="p-5 space-y-2">
                    <h3 className="font-semibold text-gray-900 leading-snug">{p.name}</h3>
                    <p className="text-sm font-semibold" style={{ color }}>
                      {min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
