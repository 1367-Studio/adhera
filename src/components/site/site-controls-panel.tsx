"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  GlobeIcon, EyeOffIcon, PlusIcon, Trash2Icon,
  ChevronUpIcon, ChevronDownIcon, ExternalLinkIcon,
  SaveIcon, PencilIcon, ChevronRightIcon, XIcon, CopyIcon, CheckIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ImageUpload } from "@/components/ui/image-upload"
import { SiteSectionSheet } from "./site-section-sheet"
import type { SiteConfig, SiteSection, SectionType, FooterLink } from "@/types/site-config"
import { DEFAULT_SITE_CONFIG, SECTION_LABELS } from "@/types/site-config"
import { cn } from "@/lib/utils"

function newId() { return Math.random().toString(36).slice(2, 10) }

function createSection(type: SectionType): SiteSection {
  switch (type) {
    case "hero":       return { id: newId(), type: "hero",       title: "Bienvenue",               subtitle: "", heroHeight: "full" as const }
    case "about":      return { id: newId(), type: "about",      title: "À propos",                content: "" }
    case "events":     return { id: newId(), type: "events",     title: "Prochains événements",    limit: 6 }
    case "membership": return { id: newId(), type: "membership", title: "Rejoindre l'association", body: "" }
    case "actualites": return { id: newId(), type: "actualites", title: "Actualités", limit: 6 }
    case "contact":    return { id: newId(), type: "contact",    title: "Contact" }
  }
}

const SECTION_TYPES: SectionType[] = ["hero", "about", "events", "actualites", "membership", "contact"]

// Accordion panel
function Panel({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
      >
        <ChevronRightIcon className={`size-3.5 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        {title}
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  )
}

type Props = {
  config:           SiteConfig | null
  published:        boolean
  isDirty:          boolean
  canEdit:          boolean
  siteUrl:          string | null
  isSaving:         boolean
  onChange:         (patch: Partial<SiteConfig>) => void
  onSave:           () => void
  onTogglePublish:  () => void
  onFilePending:    (blobUrl: string, file: File, prefix: string) => void
}

export function SiteControlsPanel({
  config, published, isDirty, canEdit, siteUrl, isSaving, onChange, onSave, onTogglePublish, onFilePending,
}: Props) {
  const [editingSection, setEditingSection] = useState<SiteSection | null>(null)
  const [sheetOpen, setSheetOpen]           = useState(false)
  const [addMenuOpen, setAddMenuOpen]       = useState(false)
  const [deletingId, setDeletingId]         = useState<string | null>(null)
  const [copied, setCopied]                 = useState(false)
  const addMenuRef      = useRef<HTMLDivElement>(null)
  const originalSection = useRef<SiteSection | null>(null)
  const appliedRef      = useRef(false)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setAddMenuOpen(false)
    }
    if (addMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleEscape)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [addMenuOpen])

  const sections     = config?.sections ?? []
  const cfg          = config ?? DEFAULT_SITE_CONFIG
  const existingTypes = new Set(sections.map(s => s.type))

  function copyLink() {
    if (!siteUrl) return
    navigator.clipboard.writeText(window.location.origin + siteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function update(patch: Partial<SiteConfig>) { onChange(patch) }

  function addSection(type: SectionType) {
    const section = createSection(type)
    update({ sections: [...sections, section] })
    setAddMenuOpen(false)
    openSheet(section)
  }

  function removeSection(id: string) {
    update({ sections: sections.filter(s => s.id !== id) })
    setDeletingId(null)
  }

  function moveSection(id: string, dir: -1 | 1) {
    const next = [...sections]
    const idx  = next.findIndex(s => s.id === id)
    if (idx < 0) return
    const to = idx + dir
    if (to < 0 || to >= next.length) return
    ;[next[idx], next[to]] = [next[to], next[idx]]
    update({ sections: next })
  }

  const onDraftChange = useCallback((draft: SiteSection) => {
    onChange({ sections: (config?.sections ?? []).map(s => s.id === draft.id ? draft : s) })
  }, [config?.sections, onChange])

  function openSheet(section: SiteSection) {
    originalSection.current = section
    appliedRef.current = false
    setEditingSection(section)
    setSheetOpen(true)
  }

  function onSaveSection(updated: SiteSection) {
    appliedRef.current = true
    update({ sections: sections.map(s => s.id === updated.id ? updated : s) })
    setSheetOpen(false)
    setEditingSection(null)
  }

  function onSheetOpenChange(open: boolean) {
    if (!open && !appliedRef.current && originalSection.current) {
      // Cancel — restore original section
      update({ sections: sections.map(s => s.id === originalSection.current!.id ? originalSection.current! : s) })
    }
    setSheetOpen(open)
    if (!open) setEditingSection(null)
  }

  // Footer links helpers
  const footerLinks: FooterLink[] = cfg.footerLinks ?? []
  function updateLink(idx: number, patch: Partial<FooterLink>) {
    const next = footerLinks.map((l, i) => i === idx ? { ...l, ...patch } : l)
    update({ footerLinks: next })
  }
  function addLink() {
    if (footerLinks.length >= 6) return
    update({ footerLinks: [...footerLinks, { label: "", url: "" }] })
  }
  function removeLink(idx: number) {
    update({ footerLinks: footerLinks.filter((_, i) => i !== idx) })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="px-4 py-3 border-b space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <Badge variant={published ? "default" : "secondary"} className="gap-1.5 text-xs">
            {published ? <GlobeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}
            {published ? "Publié" : "Non publié"}
          </Badge>
          {siteUrl && published && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={copyLink}
                title="Copier le lien"
                className="inline-flex items-center justify-center rounded-md border p-1.5 hover:bg-muted transition-colors"
              >
                {copied ? <CheckIcon className="size-3 text-green-600" /> : <CopyIcon className="size-3" />}
              </button>
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
              >
                <ExternalLinkIcon className="size-3" />
                Ouvrir
              </a>
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onTogglePublish} loading={isSaving}>
              {published ? "Dépublier" : "Publier"}
            </Button>
            <Button size="sm" className="flex-1 h-8 text-xs" disabled={!isDirty} loading={isSaving} onClick={onSave}>
              <SaveIcon className="size-3 mr-1" />
              Enregistrer
            </Button>
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* Apparence */}
        <Panel title="Apparence" defaultOpen>
          <div className="space-y-1.5">
            <Label className="text-xs">Couleur principale</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={cfg.primaryColor ?? "#6366f1"}
                onChange={e => update({ primaryColor: e.target.value })}
                className="h-8 w-10 rounded border cursor-pointer p-0.5 shrink-0"
              />
              <Input
                value={cfg.primaryColor ?? "#6366f1"}
                onChange={e => update({ primaryColor: e.target.value })}
                className="font-mono text-xs h-8"
                placeholder="#6366f1"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Logo</Label>
            <ImageUpload
              value={cfg.logoUrl || undefined}
              onChange={url => update({ logoUrl: url })}
              prefix="site-logo"
              aspectRatio="square"
              className="w-full"
              lazy
              onFilePending={onFilePending}
            />
          </div>
        </Panel>

        {/* En-tête */}
        <Panel title="En-tête">
          <div className="space-y-1.5">
            <Label className="text-xs">Couleur de fond</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={cfg.headerBgColor ?? "#ffffff"}
                onChange={e => update({ headerBgColor: e.target.value })}
                className="h-8 w-10 rounded border cursor-pointer p-0.5 shrink-0"
              />
              <Input
                value={cfg.headerBgColor ?? ""}
                onChange={e => update({ headerBgColor: e.target.value })}
                className="font-mono text-xs h-8"
                placeholder="#ffffff (blanc par défaut)"
              />
            </div>
          </div>
          {(["headerShowMembres", "headerShowRegister"] as const).map((key, i) => {
            const label  = i === 0 ? "Bouton \"Se connecter\"" : "Bouton \"S'inscrire\""
            const active = key === "headerShowMembres" ? (cfg.headerShowMembres ?? true) : (cfg.headerShowRegister ?? false)
            return (
              <div key={key} className="flex items-center justify-between">
                <Label className="text-xs">{label}</Label>
                <button
                  type="button"
                  onClick={() => update({ [key]: !active })}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${active ? "bg-foreground" : "bg-muted"}`}
                >
                  <span className={`pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${active ? "translate-x-4" : "translate-x-0"}`} />
                </button>
              </div>
            )
          })}
        </Panel>

        {/* Pied de page */}
        <Panel title="Pied de page">
          <div className="space-y-1.5">
            <Label className="text-xs">Texte</Label>
            <Input
              value={cfg.footerText ?? ""}
              onChange={e => update({ footerText: e.target.value })}
              placeholder={`© ${new Date().getFullYear()} Mon Association`}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Couleur de fond</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={cfg.footerBgColor ?? "#ffffff"}
                onChange={e => update({ footerBgColor: e.target.value })}
                className="h-8 w-10 rounded border cursor-pointer p-0.5 shrink-0"
              />
              <Input
                value={cfg.footerBgColor ?? ""}
                onChange={e => update({ footerBgColor: e.target.value })}
                className="font-mono text-xs h-8"
                placeholder="#ffffff (blanc par défaut)"
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Liens</Label>
              {footerLinks.length < 6 && (
                <button
                  type="button"
                  onClick={addLink}
                  className="text-[10px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
                >
                  <PlusIcon className="size-3" /> Ajouter
                </button>
              )}
            </div>
            {footerLinks.map((link, idx) => {
              const urlInvalid = !!link.url && !link.url.startsWith("http://") && !link.url.startsWith("https://")
              return (
              <div key={idx} className="flex gap-1.5 items-start">
                <div className="flex-1 space-y-1">
                  <Input
                    value={link.label}
                    onChange={e => updateLink(idx, { label: e.target.value })}
                    placeholder="Label"
                    className="text-xs h-7"
                  />
                  <Input
                    value={link.url}
                    onChange={e => updateLink(idx, { url: e.target.value })}
                    placeholder="https://…"
                    className={cn("text-xs h-7 font-mono", urlInvalid && "border-red-400 focus-visible:ring-red-400")}
                  />
                  {urlInvalid && <p className="text-[10px] text-red-500">L'URL doit commencer par https://</p>}
                </div>
                <button
                  type="button"
                  onClick={() => removeLink(idx)}
                  className="mt-0.5 p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors shrink-0"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            )})}
            {footerLinks.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Aucun lien. Cliquez sur Ajouter.</p>
            )}
          </div>
        </Panel>

        {/* Sections */}
        <Panel title="Sections" defaultOpen>
          {sections.length === 0 && (
            <div className="border border-dashed rounded-lg p-5 text-center text-xs text-muted-foreground">
              Aucune section. Ajoutez-en une ci-dessous.
            </div>
          )}

          <div className="space-y-2">
            {sections.map((section, idx) => (
              <div
                key={section.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border bg-card p-2.5 transition-colors",
                  editingSection?.id === section.id && "ring-1 ring-foreground/25 bg-muted/40"
                )}
              >
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
                  <p className="text-xs font-medium truncate">{section.title || SECTION_LABELS[section.type]}</p>
                  <p className="text-[10px] text-muted-foreground">{SECTION_LABELS[section.type]}</p>
                </div>

                {canEdit && (
                  <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="size-6" onClick={() => openSheet(section)}>
                      <PencilIcon className="size-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-6 text-destructive hover:text-destructive" onClick={() => setDeletingId(section.id)}>
                      <Trash2Icon className="size-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {canEdit && (
            <div className="relative pt-1" ref={addMenuRef}>
              <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={() => setAddMenuOpen(v => !v)}>
                <PlusIcon className="size-3 mr-1" />
                Ajouter une section
              </Button>
              {addMenuOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 z-20 bg-popover border rounded-lg shadow-md py-1">
                  {SECTION_TYPES.map(type => {
                    const used = existingTypes.has(type)
                    return (
                      <button
                        key={type}
                        onClick={() => !used && addSection(type)}
                        disabled={used}
                        className={cn(
                          "w-full px-3 py-2 text-left text-xs transition-colors flex items-center justify-between",
                          used ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                        )}
                      >
                        <span>{SECTION_LABELS[type]}</span>
                        {used && <CheckIcon className="size-3 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </Panel>

      </div>

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
          onOpenChange={onSheetOpenChange}
          onSave={onSaveSection}
          onDraftChange={onDraftChange}
          onFilePending={onFilePending}
        />
      )}
    </div>
  )
}
