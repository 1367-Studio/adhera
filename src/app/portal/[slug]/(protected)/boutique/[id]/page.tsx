"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeftIcon, ShoppingBagIcon, ShoppingCartIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCart } from "@/lib/hooks/use-cart"
import { cn } from "@/lib/utils"

type Variante = { id: string; label: string; price: number; stock: number }
type Produit  = {
  id:          string
  name:        string
  description: string | null
  imageUrl:    string | null
  variantes:   Variante[]
}

export default function ProduitDetailPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>()
  const router       = useRouter()
  const { addItem, count } = useCart(slug)

  const [selectedVarianteId, setSelectedVarianteId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)

  const { data: produit, isLoading, error } = useQuery<Produit>({
    queryKey: ["portal-boutique-produit", id],
    queryFn:  () => fetch(`/api/portal/boutique/${id}`).then(async r => {
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur")
      return r.json()
    }),
  })

  const fmt = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  if (isLoading) {
    return (
      // py-4 matches the real header's spacing (line ~89) so the page doesn't jump
      // down once the actual content replaces this skeleton.
      <div className="space-y-4 py-4 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="grid md:grid-cols-2 gap-6">
          <div className="aspect-square bg-muted rounded-xl" />
          <div className="space-y-4">
            <div className="h-6 w-64 bg-muted rounded" />
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-24 bg-muted rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !produit) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">Produit introuvable.</p>
        <Button variant="outline" size="sm" onClick={() => router.push(`/portal/${slug}/boutique`)}>
          <ArrowLeftIcon className="mr-1.5 size-4" />
          Retour à la boutique
        </Button>
      </div>
    )
  }

  const selectedVariante = produit.variantes.find(v => v.id === selectedVarianteId)
  const canAdd = selectedVariante && selectedVariante.stock >= quantity && quantity >= 1

  function handleAddToCart() {
    if (!produit) return
    if (!selectedVariante) { toast.error("Sélectionnez une variante"); return }
    if (selectedVariante.stock < quantity) { toast.error("Stock insuffisant"); return }
    addItem({
      produitId:     produit.id,
      varianteId:    selectedVariante.id,
      produitName:   produit.name,
      varianteLabel: selectedVariante.label,
      price:         selectedVariante.price,
      imageUrl:      produit.imageUrl,
      stock:         selectedVariante.stock,
    }, quantity)
    toast.success("Ajouté au panier")
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center gap-3 py-4">
        <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/portal/${slug}/boutique`)}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        {count > 0 && (
          <Button variant="outline" className="ml-auto" onClick={() => router.push(`/portal/${slug}/boutique/panier`)}>
            <ShoppingCartIcon className="mr-1.5 size-4" />
            Panier ({count})
          </Button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6 lg:gap-10">
        {/* Image */}
        <div className="aspect-square rounded-xl overflow-hidden border bg-muted flex items-center justify-center">
          {produit.imageUrl
            ? <img src={produit.imageUrl} alt={produit.name} className="w-full h-full object-cover" />
            : <ShoppingBagIcon className="size-16 text-muted-foreground/30" />
          }
        </div>

        {/* Info */}
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold leading-tight">{produit.name}</h1>
            {selectedVariante
              ? <p className="text-2xl font-semibold text-primary mt-1">{fmt(selectedVariante.price)}</p>
              : produit.variantes.length > 0 && (
                <p className="text-lg text-muted-foreground mt-1">
                  À partir de {fmt(Math.min(...produit.variantes.map(v => v.price)))}
                </p>
              )
            }
          </div>

          {produit.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{produit.description}</p>
          )}

          {/* Variante picker */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Variante <span className="text-destructive">*</span></p>
            <div className="flex flex-wrap gap-2">
              {produit.variantes.map(v => {
                const outOfStock = v.stock === 0
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={outOfStock}
                    onClick={() => { setSelectedVarianteId(v.id); setQuantity(1) }}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                      selectedVarianteId === v.id
                        ? "border-ring bg-background shadow-sm text-foreground"
                        : outOfStock
                        ? "opacity-40 cursor-not-allowed border-input text-muted-foreground"
                        : "border-input text-muted-foreground hover:border-ring/50 hover:text-foreground",
                    )}
                  >
                    {v.label}
                    {outOfStock && <span className="ml-1.5 text-xs opacity-70">Épuisé</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Quantity */}
          {selectedVariante && selectedVariante.stock > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Quantité</p>
              <div className="inline-flex items-center rounded-lg border gap-0.5 p-0.5">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <MinusIcon className="size-3.5" />
                </button>
                <span className="w-8 text-center text-sm font-medium tabular-nums">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.min(selectedVariante.stock, q + 1))}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{selectedVariante.stock} en stock</p>
            </div>
          )}

          {selectedVariante && selectedVariante.stock === 0 && (
            <Badge variant="secondary">Cette variante est épuisée</Badge>
          )}

          <Button
            size="lg"
            disabled={!canAdd}
            onClick={handleAddToCart}
            className="w-full sm:w-auto"
          >
            <ShoppingCartIcon className="mr-2 size-4" />
            Ajouter au panier
          </Button>
        </div>
      </div>
    </div>
  )
}
