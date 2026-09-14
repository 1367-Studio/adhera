"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ArrowLeftIcon, ShoppingBagIcon, ShoppingCartIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCart } from "@/lib/hooks/use-cart"
import { cn } from "@/lib/utils"
import { RichTextView } from "@/components/ui/rich-text-view"

type Variante = { id: string; label: string; price: number; stock: number; shippable: boolean; weightGrams: number | null }
type Produit  = {
  id:          string
  name:        string
  description: string | null
  imageUrl:    string | null
  variantes:   Variante[]
}

type Props = { slug: string; id: string }

export function BoutiqueStorefrontDetail({ slug, id }: Props) {
  const t       = useTranslations("portalMembre.boutique")
  const tCommon = useTranslations("common")
  const router  = useRouter()
  const { addItem, count } = useCart(slug)

  const [selectedVarianteId, setSelectedVarianteId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)

  const { data: produit, isLoading, error } = useQuery<Produit>({
    queryKey: ["public-boutique-produit", slug, id],
    queryFn:  () => fetch(`/api/public/${slug}/boutique/${id}`).then(async r => {
      if (!r.ok) throw new Error((await r.json()).error ?? tCommon("error"))
      return r.json()
    }),
  })

  const fmt = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const variante = produit?.variantes.find(v => v.id === selectedVarianteId) ?? produit?.variantes[0]

  function handleAddToCart() {
    if (!produit || !variante) return
    if (variante.stock < quantity) { toast.error(t("insufficientStock")); return }
    addItem({
      produitId:     produit.id,
      varianteId:    variante.id,
      produitName:   produit.name,
      varianteLabel: variante.label,
      price:         variante.price,
      imageUrl:      produit.imageUrl,
      stock:         variante.stock,
      shippable:     variante.shippable,
      weightGrams:   variante.weightGrams,
    }, quantity)
    toast.success(t("addedToCart"))
    setQuantity(1)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background py-10 px-4">
        <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="grid md:grid-cols-2 gap-6">
            <div className="aspect-square bg-muted rounded-lg" />
            <div className="space-y-3">
              <div className="h-6 w-3/4 bg-muted rounded" />
              <div className="h-4 w-1/2 bg-muted rounded" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !produit) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 gap-4">
        <p className="text-lg font-semibold">{t("notFound")}</p>
        <Button variant="outline" onClick={() => router.push(`/${slug}/boutique`)}>
          <ArrowLeftIcon className="mr-1.5 size-4" />
          {t("backToShop")}
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.push(`/${slug}/boutique`)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftIcon className="size-4" />
            {t("backToShop")}
          </button>
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

        <div className="grid md:grid-cols-2 gap-6">
          <div className="aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden">
            {produit.imageUrl
              ? <img src={produit.imageUrl} alt={produit.name} className="w-full h-full object-cover" />
              : <ShoppingBagIcon className="size-14 text-muted-foreground/40" />
            }
          </div>

          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">{produit.name}</h1>
              {variante && (
                <p className="text-lg font-semibold text-primary mt-1">{fmt(variante.price)}</p>
              )}
            </div>

            {produit.description && (
              <RichTextView content={produit.description} className="text-sm text-muted-foreground" />
            )}

            {produit.variantes.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("selectVariant")}</p>
                <div className="flex flex-wrap gap-2">
                  {produit.variantes.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      disabled={v.stock === 0}
                      onClick={() => { setSelectedVarianteId(v.id); setQuantity(1) }}
                      className={cn(
                        "rounded-md border px-3 h-9 text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none",
                        (variante?.id === v.id) ? "border-primary bg-primary/5 text-primary" : "hover:border-foreground/40",
                      )}
                    >
                      {v.label}
                      {v.stock === 0 && ` (${t("variantOutOfStock")})`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {variante && variante.stock > 0 ? (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">{t("quantity")}</p>
                  <div className="inline-flex items-center rounded-md border gap-0.5 p-0.5">
                    <button
                      type="button"
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
                    >
                      <MinusIcon className="size-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-medium tabular-nums">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity(q => Math.min(q + 1, variante.stock, 99))}
                      className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
                    >
                      <PlusIcon className="size-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("inStock", { count: variante.stock })}</p>
                </div>

                <Button className="w-full" size="lg" onClick={handleAddToCart}>
                  <ShoppingCartIcon className="mr-1.5 size-4" />
                  {t("addToCart")}
                </Button>
              </>
            ) : (
              <Badge variant="secondary">{t("outOfStock")}</Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
