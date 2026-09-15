"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { SparkleIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { SectionType } from "@/types/site-config"
import { SITE_FONTS, SITE_DEFAULT_FONT, isSiteFontKey } from "@/lib/site-fonts"

type AppearanceResult = { primaryColor: string; secondaryColor: string; fontFamily: string }
type HeaderResult      = { headerBgColor: string }
type FooterResult      = { footerText: string; footerBgColor: string }
type SectionResult     = { title: string; subtitle?: string; content?: string; body?: string; buttonLabel?: string }
type AiFieldResult = AppearanceResult | HeaderResult | FooterResult | SectionResult

type Props =
  | { scope: "appearance"; onApply: (r: AppearanceResult) => void }
  | { scope: "header"; onApply: (r: HeaderResult) => void }
  | { scope: "footer"; onApply: (r: FooterResult) => void }
  | { scope: "section"; sectionType: SectionType; onApply: (r: SectionResult) => void }

// A one-line teaser of a section's generated copy — same reasoning as the identically-named
// helpers in site-actualites-section.tsx and site-ai-assistant.tsx: trivial, kept local to
// each call site's own truncation needs rather than shared.
function excerpt(html: string, max = 90): string {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// Compact, always-available counterpart to SiteAiAssistant (the full-site generator gated to
// the empty state) — one button per block (Apparence/En-tête/Pied de page/one section), each
// only ever touching the fields of that block. Shares the same "gerar → prévia → aplicar"
// pattern as AiWriter and SiteAiAssistant, in a Popover instead of an inline panel or a Dialog
// since this is a small, single-purpose action anchored to one specific control.
export function SiteAiFieldButton(props: Props) {
  const t = useTranslations("site.aiAssistant")

  const [open, setOpen]               = useState(false)
  const [description, setDescription] = useState("")
  const [result, setResult]           = useState<AiFieldResult | null>(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState("")
  // Same staleness guard as SiteAiAssistant — closing the popover mid-generation must not let
  // a late response populate a session the admin already walked away from.
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!open) { setDescription(""); setResult(null); setError(""); requestIdRef.current++ }
  }, [open])

  async function handleGenerate() {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError("")
    try {
      const body: Record<string, unknown> = { description, scope: props.scope }
      if (props.scope === "section") body.sectionType = props.sectionType

      const res  = await fetch("/api/ai/site-assistant", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      const data = (await res.json()) as AiFieldResult & { error?: string }
      if (requestId !== requestIdRef.current) return
      if (!res.ok) { setError((data as { error?: string }).error ?? t("error")); return }
      setResult(data)
    } catch {
      if (requestId === requestIdRef.current) setError(t("error"))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  function handleApply() {
    if (!result) return
    switch (props.scope) {
      case "appearance": props.onApply(result as AppearanceResult); break
      case "header":      props.onApply(result as HeaderResult); break
      case "footer":       props.onApply(result as FooterResult); break
      case "section":      props.onApply(result as SectionResult); break
    }
    setOpen(false)
  }

  const canGenerate = description.trim().length >= 5
  const placeholder = props.scope === "appearance" ? t("appearancePlaceholder")
    : props.scope === "header" ? t("headerPlaceholder")
    : props.scope === "footer" ? t("footerPlaceholder")
    : t("sectionPlaceholder")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" title={t("fieldButtonLabel")}>
            <SparkleIcon className="text-violet-600 dark:text-violet-400" />
          </Button>
        }
      />
      <PopoverContent className="w-80 space-y-2.5">
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={placeholder}
          rows={2}
          maxLength={500}
          className="text-xs"
        />

        {!result && (
          <Button size="sm" onClick={handleGenerate} disabled={!canGenerate || loading} loading={loading} className="w-full">
            <SparkleIcon className="size-3.5 mr-1.5" />
            {t("generate")}
          </Button>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {result && (
          <>
            <div className="rounded-md border p-2 space-y-1.5 text-xs">
              {props.scope === "appearance" && (() => {
                const r = result as AppearanceResult
                const fontKey = isSiteFontKey(r.fontFamily) ? r.fontFamily : SITE_DEFAULT_FONT
                return (
                  <div className="flex items-center gap-2">
                    <span className="size-4 rounded border shrink-0" style={{ background: r.primaryColor }} />
                    <span className="size-4 rounded border shrink-0" style={{ background: r.secondaryColor }} />
                    <span className={SITE_FONTS[fontKey].variable} style={{ fontFamily: SITE_FONTS[fontKey].cssVar }}>
                      {SITE_FONTS[fontKey].label}
                    </span>
                  </div>
                )
              })()}
              {props.scope === "header" && (
                <div className="flex items-center gap-2">
                  <span className="size-4 rounded border shrink-0" style={{ background: (result as HeaderResult).headerBgColor }} />
                  <span className="text-muted-foreground">{(result as HeaderResult).headerBgColor}</span>
                </div>
              )}
              {props.scope === "footer" && (
                <div className="flex items-center gap-2">
                  <span className="size-4 rounded border shrink-0" style={{ background: (result as FooterResult).footerBgColor }} />
                  <span className="text-muted-foreground truncate">{(result as FooterResult).footerText}</span>
                </div>
              )}
              {props.scope === "section" && (() => {
                const r = result as SectionResult
                const teaser = r.content ? excerpt(r.content) : r.body ? excerpt(r.body) : r.subtitle
                return (
                  <div>
                    <p className="font-medium">{r.title}</p>
                    {teaser && <p className="text-muted-foreground">{teaser}</p>}
                  </div>
                )
              })()}
            </div>

            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={handleGenerate} loading={loading} disabled={loading} className="text-muted-foreground">
                <ArrowsClockwiseIcon className="size-3.5" />
              </Button>
              <Button size="sm" onClick={handleApply} className="flex-1">
                {t("apply")}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
