"use client"

import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { ShoppingBagIcon, ShoppingCartIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { useCart } from "@/lib/hooks/use-cart"

type Variante = { id: string; label: string; price: number; stock: number }
type Produit  = {
  id:          string
  name:        string
  description: string | null
  imageUrl:    string | null
  variantes:   Variante[]
}

type Props = { slug: string }

export function BoutiqueStorefrontListing({ slug }: Props) {
  const t      = useTranslations("portalMembre.boutique")
  const router = useRouter()
  const { count } = useCart(slug)

  const { data, isLoading, error } = useQuery<{ associationName: string; produits: Produit[] }>({
    queryKey: ["public-boutique", slug],
    queryFn:  () => fetch(`/api/public/${slug}/boutique`).then(async r => {
      if (!r.ok) throw new Error("not-found")
      return r.json()
    }),
  })

  const produits = data?.produits ?? []

  function minPrice(p: Produit) {
    if (!p.variantes.length) return 0
    return Math.min(...p.variantes.map(v => v.price))
  }
  function maxPrice(p: Produit) {
    if (!p.variantes.length) return 0
    return Math.max(...p.variantes.map(v => v.price))
  }
  function totalStock(p: Produit) {
    return p.variantes.reduce((s, v) => s + v.stock, 0)
  }

  const fmt = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 gap-2">
        <p className="text-lg font-semibold">{t("notFound")}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
            {data?.associationName && <p className="text-sm text-muted-foreground">{data.associationName}</p>}
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher persistAccountLocale={false} />
            {count > 0 && (
              <button
                type="button"
                onClick={() => router.push(`/${slug}/boutique/panier`)}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 h-9 text-sm font-medium hover:bg-muted transition-colors"
              >
                <ShoppingCartIcon className="size-4" />
                {t("cart", { count })}
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-lg border bg-muted animate-pulse" />
            ))}
          </div>
        ) : produits.length === 0 ? (
          <div className="rounded-lg border p-12 text-center space-y-2">
            <ShoppingBagIcon className="size-8 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">{t("noProducts")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {produits.map(p => {
              const stock = totalStock(p)
              const min   = minPrice(p)
              const max   = maxPrice(p)

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => router.push(`/${slug}/boutique/${p.id}`)}
                  className="group rounded-lg border bg-card overflow-hidden text-left"
                >
                  <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                    {p.imageUrl
                      ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                      : <ShoppingBagIcon className="size-10 text-muted-foreground/40" />
                    }
                  </div>
                  <div className="p-3 space-y-1">
                    <p className="font-medium text-sm leading-tight truncate">{p.name}</p>
                    <p className="text-sm font-semibold text-primary">
                      {min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`}
                    </p>
                    {stock === 0 && (
                      <Badge variant="secondary" className="text-xs">{t("outOfStock")}</Badge>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
