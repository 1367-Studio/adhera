"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeftIcon, ShoppingCartIcon, TrashIcon, MinusIcon, PlusIcon, CheckCircleIcon, CreditCardIcon, HandCoinsIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { useCart } from "@/lib/hooks/use-cart"

export default function PanierPage() {
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()
  const { items, total, updateQuantity, removeItem, clearCart } = useCart(slug)
  const [note, setNote]           = useState("")
  const [paymentMethod, setPaymentMethod] = useState<"MANUAL" | "STRIPE">("MANUAL")
  const [ordered, setOrdered]     = useState(false)

  const fmt = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        items: items.map(i => ({ produitId: i.produitId, varianteId: i.varianteId, quantity: i.quantity })),
        note:  note.trim() || null,
      }

      if (paymentMethod === "STRIPE") {
        const res = await fetch("/api/portal/boutique/checkout", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "Erreur lors du paiement")
        return { stripeUrl: d.url as string }
      }

      const res = await fetch("/api/portal/boutique/commandes", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...payload, paymentMethod: "MANUAL" }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(typeof d.error === "string" ? d.error : "Erreur lors de la commande")
      }
      return { stripeUrl: null }
    },
    onSuccess: ({ stripeUrl }) => {
      clearCart()
      if (stripeUrl) {
        window.location.href = stripeUrl
      } else {
        setOrdered(true)
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  if (ordered) {
    return (
      <div className="space-y-5 pb-10">
        <div className="max-w-lg mx-auto mt-8 rounded-xl border bg-card p-8 text-center space-y-4">
          <div className="size-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <CheckCircleIcon className="size-7 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Commande enregistrée !</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Votre commande est en attente de paiement. L'administration vous contactera pour finaliser.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button variant="outline" onClick={() => router.push(`/portal/${slug}/boutique/commandes`)}>
              Mes commandes
            </Button>
            <Button onClick={() => router.push(`/portal/${slug}/boutique`)}>
              Continuer les achats
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="space-y-5 pb-10">
        <div className="flex items-center gap-3 py-4">
          <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/portal/${slug}/boutique`)}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
            <ShoppingCartIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Mon panier</h1>
        </div>
        <div className="rounded-xl border bg-card p-12 text-center space-y-3">
          <ShoppingCartIcon className="size-8 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground text-sm">Votre panier est vide.</p>
          <Button variant="outline" onClick={() => router.push(`/portal/${slug}/boutique`)}>
            Voir la boutique
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center gap-3 py-4">
        <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/portal/${slug}/boutique`)}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
          <ShoppingCartIcon className="size-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Mon panier</h1>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Items */}
        <div className="lg:col-span-2 space-y-3">
          {items.map(item => (
            <div key={item.varianteId} className="rounded-xl border bg-card p-4 flex gap-4">
              <div className="size-16 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                {item.imageUrl
                  ? <img src={item.imageUrl} alt={item.produitName} className="w-full h-full object-cover" />
                  : <ShoppingCartIcon className="size-5 text-muted-foreground/40" />
                }
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-medium truncate">{item.produitName}</p>
                <p className="text-sm text-muted-foreground">{item.varianteLabel}</p>
                <p className="text-sm font-semibold text-primary">
                  {fmt(item.price * item.quantity)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => removeItem(item.varianteId)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <TrashIcon className="size-4" />
                </button>
                <div className="inline-flex items-center rounded-lg border gap-0.5 p-0.5">
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.varianteId, item.quantity - 1)}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <MinusIcon className="size-3" />
                  </button>
                  <span className="w-6 text-center text-xs font-medium tabular-nums">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.varianteId, item.quantity + 1)}
                    disabled={item.quantity >= item.stock}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <PlusIcon className="size-3" />
                  </button>
                </div>
                {item.quantity >= item.stock && (
                  <p className="text-[10px] text-muted-foreground">Stock max atteint</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="rounded-xl border bg-card p-5 space-y-4 h-fit">
          <h2 className="font-semibold">Récapitulatif</h2>

          <div className="space-y-2 text-sm">
            {items.map(item => (
              <div key={item.varianteId} className="flex justify-between text-muted-foreground">
                <span className="truncate mr-2">{item.produitName} ({item.quantity}×)</span>
                <span className="shrink-0 tabular-nums">{fmt(item.price * item.quantity)}</span>
              </div>
            ))}
          </div>

          <div className="border-t pt-3 flex justify-between font-semibold">
            <span>Total</span>
            <span className="tabular-nums text-primary">{fmt(total)}</span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Mode de paiement</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "MANUAL", label: "Au retrait",   icon: HandCoinsIcon  },
                { v: "STRIPE", label: "En ligne",     icon: CreditCardIcon },
              ] as const).map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setPaymentMethod(opt.v)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all ${
                    paymentMethod === opt.v
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-input text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <opt.icon className="size-4" />
                  {opt.label}
                </button>
              ))}
            </div>
            {paymentMethod === "MANUAL" && (
              <p className="text-xs text-muted-foreground">Le paiement s'effectue au retrait. L'administration vous contactera.</p>
            )}
            {paymentMethod === "STRIPE" && (
              <p className="text-xs text-muted-foreground">Vous recevrez un lien de paiement sécurisé après confirmation de la commande.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Note <span className="font-normal">(optionnel)</span></label>
            <textarea
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ex. À récupérer le samedi…"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          <Button
            className="w-full"
            size="lg"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Commander
          </Button>
        </div>
      </div>
    </div>
  )
}
