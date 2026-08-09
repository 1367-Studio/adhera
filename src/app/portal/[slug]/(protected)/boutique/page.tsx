"use client"

import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { ShoppingBagIcon, ShoppingCartIcon, PackageIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCart } from "@/lib/hooks/use-cart"

type Variante = { id: string; label: string; price: number; stock: number }
type Produit  = {
  id:          string
  name:        string
  description: string | null
  imageUrl:    string | null
  variantes:   Variante[]
}

export default function BoutiquePortalPage() {
  const t        = useTranslations("portalMembre.boutique")
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()
  const { count } = useCart(slug)

  const { data: produits = [], isLoading } = useQuery<Produit[]>({
    queryKey: ["portal-boutique", slug],
    queryFn:  () => fetch("/api/portal/boutique").then(r => r.json()),
  })

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

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center gap-3 py-4">
        <div className="rounded-lg bg-primary/10 dark:bg-primary/20 p-2.5 shrink-0">
          <ShoppingBagIcon className="size-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/portal/${slug}/boutique/commandes`)}>
            <PackageIcon className="mr-1.5 size-4" />
            {t("myOrders")}
          </Button>
          {count > 0 && (
            <Button variant="outline" onClick={() => router.push(`/portal/${slug}/boutique/panier`)}>
              <ShoppingCartIcon className="mr-1.5 size-4" />
              {t("cart", { count })}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-muted" />
          ))}
        </div>
      ) : produits.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center space-y-2">
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
                onClick={() => router.push(`/portal/${slug}/boutique/${p.id}`)}
                className="group rounded-lg border bg-card overflow-hidden text-left"
              >
                <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                  {p.imageUrl
                    ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover " />
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
  )
}
