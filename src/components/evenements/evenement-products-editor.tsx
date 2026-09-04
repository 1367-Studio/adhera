"use client"

import { useEffect, useImperativeHandle, useState, type Ref } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { Button } from "@/components/ui/button"

type BoutiqueVariante = { id: string; label: string; price: number; stock: number }
type BoutiqueProduit  = { id: string; name: string; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; variantes: BoutiqueVariante[] }
type EvenementProduct = { id: string; varianteId: string; order: number; variante: BoutiqueVariante & { produit: { id: string; name: string; status: string } } }

const MAX_PRODUCTS = 10
const fmt = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

// Mirroir exact de src/components/adhesions/membership-products-editor.tsx — voir ce fichier
// pour les commentaires détaillés sur chaque choix (ordre dérivé du catalogue, garde-fou
// MAX_PRODUCTS anticipé côté UI, etc).
export type EvenementProductsEditorHandle = { save: () => Promise<boolean> }

export function EvenementProductsEditor({ evenementId, onDirtyChange, ref }: {
  evenementId: string
  onDirtyChange?: (dirty: boolean) => void
  ref?: Ref<EvenementProductsEditorHandle>
}) {
  const t       = useTranslations("evenements.detail.steps.products")
  const tCommon = useTranslations("common")
  const qc      = useQueryClient()

  const { data: catalog, isLoading: catalogLoading } = useQuery<BoutiqueProduit[]>({
    queryKey: ["boutique-produits"],
    queryFn:  () => fetch("/api/boutique/produits").then(r => r.json()),
  })

  const { data: offered, isLoading: offeredLoading } = useQuery<EvenementProduct[]>({
    queryKey: ["evenement", evenementId, "products"],
    queryFn:  () => fetch(`/api/evenements/${evenementId}/products`).then(r => r.json()),
  })

  const saveMutation = useMutation({
    mutationFn: async (varianteIds: string[]) => {
      const res = await fetch(`/api/evenements/${evenementId}/products`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(varianteIds.map((varianteId, order) => ({ varianteId, order }))),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const message = Array.isArray(body?.error)
          ? body.error.map((issue: { message?: string }) => issue.message).filter(Boolean).join(" ")
          : body?.error
        throw new Error(message || tCommon("error"))
      }
      return res.json() as Promise<EvenementProduct[]>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evenement", evenementId, "products"] }),
  })

  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (offered) setSelected(new Set(offered.map(p => p.varianteId)))
  }, [offered])

  const activeCatalog = (catalog ?? []).filter(p => p.status === "ACTIVE" && p.variantes.length > 0)
  const activeVarianteIds = new Set(activeCatalog.flatMap(p => p.variantes.map(v => v.id)))

  const orderedSelectedIds = activeCatalog.flatMap(p => p.variantes.map(v => v.id)).filter(id => selected.has(id))
  const savedIds = (offered ?? []).map(p => p.varianteId).filter(id => activeVarianteIds.has(id))
  const isDirty = JSON.stringify([...orderedSelectedIds].sort()) !== JSON.stringify([...savedIds].sort())
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  function toggle(varianteId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(varianteId)) next.delete(varianteId)
      else next.add(varianteId)
      return next
    })
  }

  async function handleSave(): Promise<boolean> {
    if (orderedSelectedIds.length > MAX_PRODUCTS) {
      toast.error(t("maxProductsError", { max: MAX_PRODUCTS }))
      return false
    }
    try {
      await saveMutation.mutateAsync(orderedSelectedIds)
      toast.success(t("saved"))
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
      return false
    }
  }
  useImperativeHandle(ref, () => ({ save: handleSave }))

  if (catalogLoading || offeredLoading) return <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("hint")}</p>

      {activeCatalog.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noProducts")}</p>
      )}

      <div className="space-y-4">
        {activeCatalog.map(produit => (
          <div key={produit.id} className="space-y-1.5">
            <p className="text-sm font-medium">{produit.name}</p>
            <div className="space-y-1.5 pl-1">
              {produit.variantes.map(variante => {
                const checked = selected.has(variante.id)
                return (
                <div key={variante.id} className="flex items-center justify-between gap-3">
                  <CheckboxField
                    label={`${variante.label} — ${fmt(variante.price)}`}
                    checked={checked}
                    disabled={!checked && orderedSelectedIds.length >= MAX_PRODUCTS}
                    onChange={() => toggle(variante.id)}
                  />
                  <span className="text-xs text-muted-foreground">
                    {variante.stock > 0 ? t("stockCount", { count: variante.stock }) : t("outOfStock")}
                  </span>
                </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">{t("selectedCount", { count: orderedSelectedIds.length, max: MAX_PRODUCTS })}</span>
        <Button type="button" size="sm" disabled={!isDirty} onClick={handleSave} loading={saveMutation.isPending}>
          {t("saveProducts")}
        </Button>
      </div>
    </div>
  )
}
