"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeftIcon, PlusIcon, TrashIcon, ShoppingBagIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ImageUpload } from "@/components/ui/image-upload"
import { CurrencyInput } from "@/components/ui/currency-field"
import { SelectField } from "@/components/ui/select-field"
import { useFinanceCategories } from "@/hooks/use-finance-categories"
import { cn } from "@/lib/utils"

type VarianteRow = { _key: string; label: string; price: number; stock: string }

function newVariante(): VarianteRow {
  return { _key: crypto.randomUUID(), label: "", price: 0, stock: "0" }
}

export default function NouveauProduitPage() {
  const router = useRouter()

  const [name, setName]               = useState("")
  const [description, setDescription] = useState("")
  const [imageUrl, setImageUrl]       = useState("")
  const [status, setStatus]           = useState<"DRAFT" | "ACTIVE">("DRAFT")
  const [categoryId, setCategoryId]   = useState("")
  const [variantes, setVariantes]     = useState<VarianteRow[]>([newVariante()])

  const { data: categories = [] } = useFinanceCategories("INCOME")
  const categoryOptions = [
    { value: "", label: "Aucune catégorie" },
    ...categories.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name })),
  ]

  function addVariante() { setVariantes(prev => [...prev, newVariante()]) }
  function removeVariante(key: string) { setVariantes(prev => prev.filter(v => v._key !== key)) }
  function updateVariante<K extends keyof Omit<VarianteRow, "_key">>(key: string, field: K, value: VarianteRow[K]) {
    setVariantes(prev => prev.map(v => v._key === key ? { ...v, [field]: value } : v))
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = variantes.map(v => ({
        label: v.label.trim(),
        price: Math.round(v.price * 100),
        stock: parseInt(v.stock, 10) || 0,
      }))
      const res = await fetch("/api/boutique/produits", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:        name.trim(),
          description: description.trim() || null,
          imageUrl:    imageUrl.trim()    || null,
          status,
          categoryId:  categoryId || null,
          variantes:   parsed,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(typeof d.error === "string" ? d.error : "Erreur lors de la création")
      }
      return res.json()
    },
    onSuccess: (data) => {
      toast.success("Produit créé")
      router.push(`/dashboard/boutique/${data.id}`)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error("Le nom est obligatoire"); return }
    if (variantes.length === 0) { toast.error("Au moins une variante est requise"); return }
    for (const v of variantes) {
      if (!v.label.trim()) { toast.error("Chaque variante doit avoir un libellé"); return }
    }
    mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button type="button" variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="rounded-xl bg-primary/10 dark:bg-primary/20 p-2.5 shrink-0">
          <ShoppingBagIcon className="size-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Nouveau produit</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Ajoutez un produit à votre boutique.</p>
        </div>
      </div>

      {/* Card */}
      <div className="rounded-xl border bg-card overflow-hidden pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x">

          {/* Left — informations */}
          <div className="lg:col-span-2 p-5 space-y-4">
            <h2 className="text-sm font-semibold">Informations générales</h2>

            <div className="space-y-1.5">
              <Label htmlFor="name">Nom <span className="text-destructive ml-0.5">*</span></Label>
              <Input
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex. Maillot de l'association"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="desc">Description <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
              <textarea
                id="desc"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Décrivez le produit…"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Image du produit <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
              <ImageUpload
                value={imageUrl}
                onChange={setImageUrl}
                prefix="adhera/boutique"
                aspectRatio="square"
                className="w-4/5 mx-auto"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Visibilité</Label>
              <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 gap-0.5 w-full">
                {([
                  { v: "DRAFT",  l: "Brouillon" },
                  { v: "ACTIVE", l: "En ligne"  },
                ] as const).map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setStatus(opt.v)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                      status === opt.v
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <SelectField
              label="Catégorie comptable"
              options={categoryOptions}
              value={categoryId}
              onValueChange={setCategoryId}
              placeholder="Aucune catégorie"
            />
          </div>

          {/* Right — variantes */}
          <div className="lg:col-span-3 p-5 space-y-4">
            <h2 className="text-sm font-semibold">
              Variantes <span className="text-destructive ml-0.5">*</span>
              <span className="text-muted-foreground font-normal ml-1.5">(taille, couleur, etc.)</span>
            </h2>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_140px_80px_32px] gap-2 px-1">
                <p className="text-xs text-muted-foreground font-medium">Libellé</p>
                <p className="text-xs text-muted-foreground font-medium">Prix</p>
                <p className="text-xs text-muted-foreground font-medium">Stock</p>
                <span />
              </div>

              {variantes.map(v => (
                <div key={v._key} className="grid grid-cols-[1fr_140px_80px_32px] gap-2 items-center">
                  <Input
                    className="h-9"
                    placeholder="Ex. Taille M / Bleu"
                    value={v.label}
                    onChange={e => updateVariante(v._key, "label", e.target.value)}
                  />
                  <CurrencyInput
                    value={v.price}
                    onChange={euros => updateVariante(v._key, "price", euros)}
                  />
                  <Input
                    className="h-9"
                    type="number" min="0" placeholder="0"
                    value={v.stock}
                    onChange={e => updateVariante(v._key, "stock", e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeVariante(v._key)}
                    disabled={variantes.length === 1}
                    className="flex items-center justify-center size-8 rounded-lg border text-muted-foreground hover:text-destructive hover:border-destructive/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addVariante}>
                <PlusIcon className="size-3.5" />
                Ajouter une variante
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t px-5 py-3 bg-muted/20 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>Annuler</Button>
          <Button type="submit" loading={mutation.isPending}>Créer le produit</Button>
        </div>
      </div>
    </form>
  )
}
