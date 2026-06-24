"use client"

import { useState, useEffect } from "react"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ImageUpload } from "@/components/ui/image-upload"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { SiteSection } from "@/types/site-config"
import { SECTION_LABELS } from "@/types/site-config"

type Props = {
  section:        SiteSection
  open:           boolean
  onOpenChange:   (open: boolean) => void
  onSave:         (section: SiteSection) => void
  onDraftChange?: (section: SiteSection) => void
  onFilePending?: (blobUrl: string, file: File, prefix: string) => void
}

export function SiteSectionSheet({ section, open, onOpenChange, onSave, onDraftChange, onFilePending }: Props) {
  const [draft, setDraft]           = useState<SiteSection>(section)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => { setDraft(section) }, [section])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set(key: string, value: any) {
    setDraft(prev => {
      const next = { ...prev, [key]: value } as SiteSection
      onDraftChange?.(next)
      return next
    })
  }

  function setLimit(raw: string) {
    const n = parseInt(raw, 10)
    set("limit", isNaN(n) ? 1 : Math.max(1, Math.min(20, n)))
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      const hasChanges = JSON.stringify(draft) !== JSON.stringify(section)
      if (hasChanges) {
        setConfirmClose(true)
        return
      }
    }
    onOpenChange(open)
  }

  function forceClose() {
    setConfirmClose(false)
    onOpenChange(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0 overflow-hidden">
          <SheetHeader className="px-4 pt-10 pb-4 border-b shrink-0">
            <SheetTitle>Modifier — {SECTION_LABELS[draft.type]}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-4 p-4 overflow-y-auto">
            {/* Title (all sections) */}
            <div className="space-y-1.5">
              <Label className="text-xs">Titre de la section</Label>
              <Input
                value={draft.title ?? ""}
                onChange={e => set("title", e.target.value)}
                placeholder={SECTION_LABELS[draft.type]}
                maxLength={80}
              />
            </div>

            {/* Hero */}
            {draft.type === "hero" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Sous-titre</Label>
                  <Textarea
                    value={draft.subtitle ?? ""}
                    onChange={e => set("subtitle", e.target.value as never)}
                    rows={3}
                    maxLength={300}
                    placeholder="Découvrez notre association…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Hauteur de la bannière</Label>
                  <div className="flex gap-2">
                    {(["full", "half"] as const).map(value => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => set("heroHeight", value)}
                        className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                          (draft.heroHeight ?? "full") === value
                            ? "border-foreground bg-foreground text-background"
                            : "border-border text-muted-foreground hover:border-foreground/50"
                        }`}
                      >
                        {value === "full" ? "Page entière" : "Demi-page"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Image de fond (optionnel)</Label>
                  <ImageUpload
                    value={draft.image || undefined}
                    onChange={url => set("image", url as never)}
                    prefix="site-hero"
                    aspectRatio="wide"
                    lazy
                    onFilePending={onFilePending}
                  />
                  <p className="text-[11px] text-muted-foreground">Une superposition sombre sera ajoutée automatiquement.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Couleur de fond (optionnel)</Label>
                  <p className="text-[11px] text-muted-foreground mb-1.5">Ignorée si une image est définie.</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={draft.bgColor ?? "#6366f1"}
                      onChange={e => set("bgColor", e.target.value as never)}
                      className="h-9 w-14 rounded border cursor-pointer p-0.5"
                    />
                    <Input
                      value={draft.bgColor ?? ""}
                      onChange={e => set("bgColor", e.target.value as never)}
                      placeholder="Utilise la couleur principale par défaut"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
              </>
            )}

            {/* About */}
            {draft.type === "about" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Contenu</Label>
                <Textarea
                  value={"content" in draft ? draft.content : ""}
                  onChange={e => set("content", e.target.value as never)}
                  rows={8}
                  maxLength={5000}
                  placeholder="Présentez votre association…"
                />
              </div>
            )}

            {/* Events */}
            {draft.type === "events" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Nombre d'événements à afficher</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={"limit" in draft ? (draft.limit || 1) : 6}
                  onChange={e => setLimit(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Les événements sont automatiquement tirés de votre calendrier.</p>
              </div>
            )}

            {/* Actualités */}
            {draft.type === "actualites" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Nombre d'actualités à afficher</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={"limit" in draft ? (draft.limit || 1) : 6}
                  onChange={e => setLimit(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Seules les N premières actualités publiées seront affichées sur le site.</p>
              </div>
            )}

            {/* Membership */}
            {draft.type === "membership" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Texte introductif</Label>
                <Textarea
                  value={"body" in draft ? draft.body : ""}
                  onChange={e => set("body", e.target.value as never)}
                  rows={4}
                  maxLength={500}
                  placeholder="Remplissez ce formulaire pour demander à rejoindre l'association…"
                />
                <p className="text-xs text-muted-foreground">
                  Les demandes apparaissent dans la liste des membres avec le statut &quot;En attente&quot;.
                </p>
              </div>
            )}

            {/* Contact */}
            {draft.type === "contact" && (
              <p className="text-xs text-muted-foreground">
                Cette section affiche automatiquement la ville et le pays configurés dans les paramètres de l&apos;association.
              </p>
            )}
          </div>

          <SheetFooter className="border-t px-4 py-3 shrink-0 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Annuler</Button>
            <Button onClick={() => onSave(draft)}>Appliquer</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Ignorer les modifications ?"
        description="Les modifications non appliquées seront perdues."
        confirmLabel="Ignorer"
        onConfirm={forceClose}
      />
    </>
  )
}
