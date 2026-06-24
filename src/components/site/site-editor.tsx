"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import {
  GlobeIcon, EyeOffIcon, PlusIcon, Trash2Icon,
  ChevronUpIcon, ChevronDownIcon, ExternalLinkIcon,
  SaveIcon, PencilIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useSiteConfig, useSaveSiteConfig } from "@/hooks/use-site-config"
import type { SiteConfig, SiteSection, SectionType } from "@/types/site-config"
import { DEFAULT_SITE_CONFIG, SECTION_LABELS } from "@/types/site-config"
import { SiteSectionSheet } from "./site-section-sheet"

function newId() { return Math.random().toString(36).slice(2, 10) }

function createSection(type: SectionType): SiteSection {
  switch (type) {
    case "hero":       return { id: newId(), type: "hero",       title: "Bienvenue",              subtitle: "" }
    case "about":      return { id: newId(), type: "about",      title: "À propos",               content: "" }
    case "events":     return { id: newId(), type: "events",     title: "Prochains événements",   limit: 6 }
    case "actualites": return { id: newId(), type: "actualites", title: "Actualités",             limit: 6 }
    case "membership": return { id: newId(), type: "membership", title: "Rejoindre l'association", body: "" }
    case "contact":    return { id: newId(), type: "contact",    title: "Contact" }
  }
}

const SECTION_TYPES: SectionType[] = ["hero", "about", "events", "membership", "contact"]

export function SiteEditor({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useSiteConfig()
  const saveMutation = useSaveSiteConfig()

  const [config, setConfig]               = useState<SiteConfig | null>(null)
  const [published, setPublished]         = useState(false)
  const [isDirty, setIsDirty]             = useState(false)
  const [editingSection, setEditingSection] = useState<SiteSection | null>(null)
  const [sheetOpen, setSheetOpen]         = useState(false)
  const [addMenuOpen, setAddMenuOpen]     = useState(false)
  const [deletingId, setDeletingId]       = useState<string | null>(null)
  const initialized  = useRef(false)
  const addMenuRef   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true
      setConfig(data.config ?? DEFAULT_SITE_CONFIG)
      setPublished(data.published)
    }
  }, [data])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    if (addMenuOpen) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [addMenuOpen])

  function markDirty() { setIsDirty(true) }

  function updateConfig(patch: Partial<SiteConfig>) {
    setConfig(prev => prev ? { ...prev, ...patch } : { ...DEFAULT_SITE_CONFIG, ...patch })
    markDirty()
  }

  function addSection(type: SectionType) {
    const section = createSection(type)
    updateConfig({ sections: [...(config?.sections ?? []), section] })
    setAddMenuOpen(false)
    setEditingSection(section)
    setSheetOpen(true)
  }

  function removeSection(id: string) {
    updateConfig({ sections: (config?.sections ?? []).filter(s => s.id !== id) })
    setDeletingId(null)
  }

  function moveSection(id: string, dir: -1 | 1) {
    const sections = [...(config?.sections ?? [])]
    const idx = sections.findIndex(s => s.id === id)
    if (idx < 0) return
    const next = idx + dir
    if (next < 0 || next >= sections.length) return
    ;[sections[idx], sections[next]] = [sections[next], sections[idx]]
    updateConfig({ sections })
  }

  function openEdit(section: SiteSection) {
    setEditingSection(section)
    setSheetOpen(true)
  }

  function onSaveSection(updated: SiteSection) {
    updateConfig({ sections: (config?.sections ?? []).map(s => s.id === updated.id ? updated : s) })
    setSheetOpen(false)
    setEditingSection(null)
  }

  async function save() {
    if (!config) return
    try {
      await saveMutation.mutateAsync(config)
      setIsDirty(false)
      toast.success("Site sauvegardé")
    } catch {
      toast.error("Erreur lors de la sauvegarde")
    }
  }

  async function togglePublish() {
    if (isDirty) {
      toast.warning("Enregistrez vos modifications avant de publier.")
      return
    }
    const next = !published
    try {
      await saveMutation.mutateAsync({ published: next })
      setPublished(next)
      toast.success(next ? "Site publié" : "Site dépublié")
    } catch {
      toast.error("Erreur")
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-muted" />)}
      </div>
    )
  }

  const sections = config?.sections ?? []
  const siteUrl  = data?.slug ? `/${data.slug}` : null

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant={published ? "default" : "secondary"} className="gap-1.5">
            {published ? <GlobeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}
            {published ? "Publié" : "Non publié"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {siteUrl && published && (
            <a
              href={siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <ExternalLinkIcon className="size-3.5" />
              Voir le site
            </a>
          )}
          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={togglePublish}
                loading={saveMutation.isPending}
              >
                {published ? "Dépublier" : "Publier"}
              </Button>
              <Button
                size="sm"
                disabled={!isDirty}
                loading={saveMutation.isPending}
                onClick={save}
              >
                <SaveIcon className="size-3.5 mr-1.5" />
                Enregistrer
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Global settings */}
      {canEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg border bg-muted/30">
          <div className="space-y-1.5">
            <Label className="text-xs">Couleur principale</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={config?.primaryColor ?? "#6366f1"}
                onChange={e => updateConfig({ primaryColor: e.target.value })}
                className="h-9 w-14 rounded border cursor-pointer p-0.5"
              />
              <Input
                value={config?.primaryColor ?? "#6366f1"}
                onChange={e => updateConfig({ primaryColor: e.target.value })}
                className="font-mono text-sm h-9"
                placeholder="#6366f1"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">URL du logo (optionnel)</Label>
            <Input
              value={config?.logoUrl ?? ""}
              onChange={e => updateConfig({ logoUrl: e.target.value })}
              placeholder="https://…"
              className="text-sm h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Texte du pied de page</Label>
            <Input
              value={config?.footerText ?? ""}
              onChange={e => updateConfig({ footerText: e.target.value })}
              placeholder={`© ${new Date().getFullYear()} Mon Association`}
              className="text-sm h-9"
            />
          </div>
        </div>
      )}

      {/* Sections list */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sections</p>

        {sections.length === 0 && (
          <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
            Aucune section. Ajoutez-en une ci-dessous.
          </div>
        )}

        {sections.map((section, idx) => (
          <div key={section.id} className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => moveSection(section.id, -1)}
                disabled={idx === 0 || !canEdit}
                className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
              >
                <ChevronUpIcon className="size-3.5" />
              </button>
              <button
                onClick={() => moveSection(section.id, 1)}
                disabled={idx === sections.length - 1 || !canEdit}
                className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
              >
                <ChevronDownIcon className="size-3.5" />
              </button>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{section.title || SECTION_LABELS[section.type]}</p>
              <p className="text-xs text-muted-foreground">{SECTION_LABELS[section.type]}</p>
            </div>

            {canEdit && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(section)}>
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => setDeletingId(section.id)}>
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add section */}
      {canEdit && (
        <div className="relative" ref={addMenuRef}>
          <Button variant="outline" size="sm" onClick={() => setAddMenuOpen(v => !v)}>
            <PlusIcon className="size-3.5 mr-1.5" />
            Ajouter une section
          </Button>
          {addMenuOpen && (
            <div className="absolute top-full left-0 mt-1 z-20 bg-popover border rounded-lg shadow-md py-1 min-w-48">
              {SECTION_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => addSection(type)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                >
                  {SECTION_LABELS[type]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={open => !open && setDeletingId(null)}
        title="Supprimer la section"
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        onConfirm={() => { if (deletingId) removeSection(deletingId) }}
      />

      {editingSection && (
        <SiteSectionSheet
          section={editingSection}
          open={sheetOpen}
          onOpenChange={open => { setSheetOpen(open); if (!open) setEditingSection(null) }}
          onSave={onSaveSection}
        />
      )}
    </div>
  )
}
