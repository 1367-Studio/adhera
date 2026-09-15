"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { SparkleIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { SiteSection, SectionType } from "@/types/site-config"
import { SITE_FONTS, SITE_DEFAULT_FONT, isSiteFontKey } from "@/lib/site-fonts"
import { newSectionId } from "@/lib/site-content"

export type AiSiteDraft = {
  primaryColor:       string
  secondaryColor:     string
  fontFamily:         string
  headerBgColor:      string
  headerShowMembres:  boolean
  headerShowRegister: boolean
  footerText:         string
  footerBgColor:      string
  sections:           SiteSection[]
}

type ApiSection = {
  type:        string
  title:       string
  subtitle?:   string
  content?:    string
  body?:       string
  buttonLabel?: string
}

type ApiResponse = Omit<AiSiteDraft, "sections" | "fontFamily"> & { fontFamily: string; sections: ApiSection[] }

// The API only returns the text fields it generated (title/subtitle/content/body/buttonLabel)
// — structural defaults (limit, heroHeight) and the id are the builder's own concern, same as
// createSection() in site-controls-panel.tsx for a manually-added section. "membership" is
// never produced (the API's allowed-types list already excludes it), so an unrecognized
// `type` here can only mean a malformed response slipping past the server's own validation —
// dropped rather than crashing the dialog.
function toSiteSection(raw: ApiSection): SiteSection | null {
  const id = newSectionId()
  switch (raw.type as SectionType) {
    case "hero":       return { id, type: "hero", title: raw.title, subtitle: raw.subtitle ?? "", heroHeight: "full" }
    case "about":      return { id, type: "about", title: raw.title, content: raw.content ?? "" }
    case "events":     return { id, type: "events", title: raw.title, limit: 6 }
    case "actualites": return { id, type: "actualites", title: raw.title, limit: 6 }
    case "dons":       return { id, type: "dons", title: raw.title, body: raw.body ?? "", buttonLabel: raw.buttonLabel ?? "" }
    case "boutique":   return { id, type: "boutique", title: raw.title, limit: 6 }
    case "contact":    return { id, type: "contact", title: raw.title }
    default:           return null
  }
}

// A plain-text one-line teaser of a section's generated copy — same reasoning as the
// identically-named helper in site-actualites-section.tsx (not shared: trivial and local to
// each call site's own truncation needs).
function excerpt(html: string, max = 90): string {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function sectionExcerpt(section: SiteSection): string | null {
  switch (section.type) {
    case "hero":  return section.subtitle || null
    case "about": return excerpt(section.content) || null
    case "dons":  return excerpt(section.body) || null
    default:      return null
  }
}

type Props = {
  open:         boolean
  onOpenChange: (open: boolean) => void
  onApply:      (draft: AiSiteDraft) => void
}

export function SiteAiAssistant({ open, onOpenChange, onApply }: Props) {
  const t = useTranslations("site.aiAssistant")
  const tSections = useTranslations("site.sectionLabels")

  const [description, setDescription] = useState("")
  const [draft, setDraft]             = useState<AiSiteDraft | null>(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState("")
  // Guards against a slow generate call resolving after the admin closed the dialog (and
  // its effect below reset local state) and reopened it — without this, that stale response
  // would still land via setDraft/setError into what looks like a brand-new session.
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!open) { setDescription(""); setDraft(null); setError(""); requestIdRef.current++ }
  }, [open])

  async function handleGenerate() {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError("")
    try {
      const res  = await fetch("/api/ai/site-assistant", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ description }),
      })
      const data = (await res.json()) as ApiResponse & { error?: string }
      if (requestId !== requestIdRef.current) return
      if (!res.ok) { setError(data.error ?? t("error")); return }

      const sections = data.sections.map(toSiteSection).filter((s): s is SiteSection => s !== null)
      setDraft({ ...data, sections })
    } catch {
      if (requestId === requestIdRef.current) setError(t("error"))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  const canGenerate = description.trim().length >= 5
  const fontKey     = isSiteFontKey(draft?.fontFamily) ? draft.fontFamily : SITE_DEFAULT_FONT

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <SparkleIcon className="size-4 text-violet-600 dark:text-violet-400" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="text-xs">{t("descriptionLabel")}</Label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            rows={3}
            maxLength={500}
          />
        </div>

        {!draft && (
          <Button onClick={handleGenerate} disabled={!canGenerate || loading} loading={loading} className="w-full">
            <SparkleIcon className="size-3.5 mr-1.5" />
            {t("generate")}
          </Button>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {draft && (
          <div className="space-y-4 rounded-lg border p-3">
            {/* Apparence */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">{t("previewAppearance")}</p>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="size-5 rounded border shrink-0" style={{ background: draft.primaryColor }} />
                  <span className="size-5 rounded border shrink-0" style={{ background: draft.secondaryColor }} />
                </div>
                <span className={SITE_FONTS[fontKey].variable} style={{ fontFamily: SITE_FONTS[fontKey].cssVar }}>
                  {SITE_FONTS[fontKey].label}
                </span>
              </div>
            </div>

            {/* En-tête */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">{t("previewHeader")}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-5 rounded border shrink-0" style={{ background: draft.headerBgColor }} />
                <span>
                  {draft.headerShowMembres ? t("previewHeaderLogin") : ""}
                  {draft.headerShowMembres && draft.headerShowRegister ? " · " : ""}
                  {draft.headerShowRegister ? t("previewHeaderRegister") : ""}
                </span>
              </div>
            </div>

            {/* Pied de page */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">{t("previewFooter")}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-5 rounded border shrink-0" style={{ background: draft.footerBgColor }} />
                <span className="truncate">{draft.footerText}</span>
              </div>
            </div>

            {/* Sections */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">{t("previewSections")}</p>
              <ul className="space-y-1.5">
                {draft.sections.map(section => {
                  const teaser = sectionExcerpt(section)
                  return (
                    <li key={section.id} className="text-xs">
                      <span className="font-medium">{tSections(section.type)}</span>
                      {section.title && <span className="text-muted-foreground"> — {section.title}</span>}
                      {teaser && <p className="text-muted-foreground truncate">{teaser}</p>}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}

        {draft && (
          <DialogFooter>
            <Button variant="ghost" onClick={handleGenerate} loading={loading} disabled={loading}>
              <ArrowsClockwiseIcon className="size-3.5 mr-1.5" />
              {t("regenerate")}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={() => { onApply(draft); onOpenChange(false) }}>
              {t("apply")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
