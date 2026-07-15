"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CrownIcon } from "@phosphor-icons/react/dist/ssr";
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ImageUpload } from "@/components/ui/image-upload"

type BrandingData = {
  logoUrl:        string | null
  primaryColor:   string | null
  secondaryColor: string | null
}

interface BrandingSettingsProps {
  canEdit: boolean
  canUse:  boolean
  data:    BrandingData
}

const DEFAULT_PRIMARY = "#6366f1"

export function BrandingSettings({ canEdit, canUse, data }: BrandingSettingsProps) {
  const qc     = useQueryClient()
  const router = useRouter()

  const [logoUrl, setLogoUrl]             = useState(data.logoUrl ?? "")
  const [primaryColor, setPrimaryColor]   = useState(data.primaryColor ?? DEFAULT_PRIMARY)
  const [secondaryColor, setSecondaryColor] = useState(data.secondaryColor ?? "")
  const [dirty, setDirty]                 = useState(false)
  // Same lazy-upload pattern as the site builder (src/components/site/site-view.tsx):
  // picking a file only creates a local blob: preview, the real /api/upload only happens
  // at save time — so cancelling out of this screen never leaves an orphaned file in R2.
  const [pendingFile, setPendingFile] = useState<{ blobUrl: string; file: File } | null>(null)

  useEffect(() => {
    setLogoUrl(data.logoUrl ?? "")
    setPrimaryColor(data.primaryColor ?? DEFAULT_PRIMARY)
    setSecondaryColor(data.secondaryColor ?? "")
    setDirty(false)
  }, [data])

  useEffect(() => {
    if (!pendingFile) return
    return () => URL.revokeObjectURL(pendingFile.blobUrl)
  }, [pendingFile])

  function handleLogoChange(url: string) {
    if (url === "") setPendingFile(null) // "Retirer" clicked — nothing left to upload
    setLogoUrl(url)
    setDirty(true)
  }

  function handleFilePending(blobUrl: string, file: File) {
    setPendingFile({ blobUrl, file })
    setDirty(true)
  }

  const mutation = useMutation({
    mutationFn: async () => {
      let finalLogoUrl = logoUrl
      if (pendingFile) {
        const fd = new FormData()
        fd.append("file", pendingFile.file)
        fd.append("prefix", "brand-logo")
        const uploadRes = await fetch("/api/upload", { method: "POST", body: fd })
        if (!uploadRes.ok) throw new Error("Erreur lors de l'upload du logo")
        finalLogoUrl = ((await uploadRes.json()) as { url: string }).url
      }

      const res = await fetch("/api/association/branding", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ logoUrl: finalLogoUrl, primaryColor, secondaryColor }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(typeof d.error === "string" ? d.error : "Erreur")
      }
      return { logoUrl: finalLogoUrl }
    },
    onSuccess: ({ logoUrl: savedLogoUrl }) => {
      setPendingFile(null)
      setLogoUrl(savedLogoUrl)
      qc.invalidateQueries({ queryKey: ["association"] })
      // The sidebar logo and --primary/--secondary CSS vars come from the layout server
      // component (src/app/dashboard/layout.tsx), not this page's own fetch — refresh()
      // re-renders it with the new DB values without a full page reload.
      router.refresh()
      toast.success("Identité visuelle mise à jour")
      setDirty(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  if (!canUse) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Identité visuelle</h3>
        <div className="flex items-start gap-2 rounded-lg border p-4 text-xs text-muted-foreground">
          <CrownIcon className="size-3.5 shrink-0 mt-0.5 text-amber-500" />
          <span>
            Le logo et les couleurs personnalisés (dashboard, devis/factures, feuille de
            présence) sont réservés à la formule Pro. Passez à la formule supérieure dans
            l&apos;onglet Abonnement pour les activer.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Identité visuelle</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Logo et couleurs affichés sur le dashboard, les devis/factures, la feuille de
          présence et le site public.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="space-y-1.5 shrink-0">
          <Label className="text-xs">Logo</Label>
          <ImageUpload
            value={logoUrl || undefined}
            onChange={handleLogoChange}
            prefix="brand-logo"
            aspectRatio="square"
            className="w-40"
            lazy
            onFilePending={handleFilePending}
          />
        </div>

        <div className="flex-1 grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Couleur primaire</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                disabled={!canEdit}
                value={primaryColor || DEFAULT_PRIMARY}
                onChange={e => { setPrimaryColor(e.target.value); setDirty(true) }}
                className="h-9 w-10 rounded border cursor-pointer p-0.5 shrink-0 disabled:opacity-60"
              />
              <Input
                disabled={!canEdit}
                value={primaryColor}
                onChange={e => { setPrimaryColor(e.target.value); setDirty(true) }}
                className="font-mono text-xs"
                placeholder={DEFAULT_PRIMARY}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Couleur secondaire</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                disabled={!canEdit}
                value={secondaryColor || "#ffffff"}
                onChange={e => { setSecondaryColor(e.target.value); setDirty(true) }}
                className="h-9 w-10 rounded border cursor-pointer p-0.5 shrink-0 disabled:opacity-60"
              />
              <Input
                disabled={!canEdit}
                value={secondaryColor}
                onChange={e => { setSecondaryColor(e.target.value); setDirty(true) }}
                className="font-mono text-xs"
                placeholder="Optionnel"
              />
            </div>
          </div>
        </div>
      </div>

      {canEdit && (
        <Button
          size="sm"
          disabled={!dirty}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Enregistrer
        </Button>
      )}
    </div>
  )
}
