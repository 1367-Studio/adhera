"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { ArrowLeftIcon, ShoppingBagIcon, PackageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type CommandeItem = {
  quantity:  number
  unitPrice: number
  produit:   { name: string; imageUrl: string | null }
  variante:  { label: string }
}
type Commande = {
  id:            string
  status:        "PENDING" | "PAID" | "CANCELLED"
  totalAmount:   number
  note:          string | null
  createdAt:     string
  items:         CommandeItem[]
}

const STATUS_LABEL: Record<string, string>   = { PENDING: "En attente", PAID: "Payée", CANCELLED: "Annulée" }
const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive"> = {
  PENDING:   "secondary",
  PAID:      "default",
  CANCELLED: "destructive",
}

export default function MesCommandesPage() {
  const { slug }       = useParams<{ slug: string }>()
  const router         = useRouter()
  const searchParams   = useSearchParams()
  const fmt            = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  useEffect(() => {
    if (searchParams.get("payment") === "success") {
      toast.success("Paiement confirmé ! Votre commande est enregistrée.")
      router.replace(`/portal/${slug}/boutique/commandes`)
    }
  }, [searchParams, router, slug])

  const { data: commandes = [], isLoading } = useQuery<Commande[]>({
    queryKey: ["portal-boutique-commandes", slug],
    queryFn:  () => fetch("/api/portal/boutique/commandes").then(r => r.json()),
  })

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center gap-3 py-4">
        <Button type="button" variant="ghost" size="icon" onClick={() => router.push(`/portal/${slug}/boutique`)}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
          <PackageIcon className="size-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Mes commandes</h1>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
      ) : commandes.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center space-y-3">
          <ShoppingBagIcon className="size-8 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground text-sm">Aucune commande pour le moment.</p>
          <Button variant="outline" onClick={() => router.push(`/portal/${slug}/boutique`)}>
            Voir la boutique
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {commandes.map(c => (
            <div key={c.id} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(c.createdAt), "d MMMM yyyy", { locale: fr })}
                  </p>
                  <p className="font-semibold text-primary tabular-nums">{fmt(c.totalAmount)}</p>
                </div>
                <Badge variant={STATUS_VARIANT[c.status]}>
                  {STATUS_LABEL[c.status]}
                </Badge>
              </div>

              <div className="space-y-1">
                {c.items.map((item, i) => (
                  <div key={`${c.id}-${item.variante.label}-${i}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="size-6 rounded bg-muted shrink-0 overflow-hidden">
                      {item.produit.imageUrl && (
                        <img src={item.produit.imageUrl} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <span>{item.quantity}× {item.produit.name} – {item.variante.label}</span>
                    <span className="ml-auto tabular-nums">{fmt(item.unitPrice * item.quantity)}</span>
                  </div>
                ))}
              </div>

              {c.note && (
                <p className="text-xs text-muted-foreground italic border-t pt-2">Note : {c.note}</p>
              )}

              {c.status === "PENDING" && (
                <p className="text-xs text-muted-foreground border-t pt-2">
                  En attente de confirmation. L'administration vous contactera pour le retrait.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
