"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ImageUpload } from "@/components/ui/image-upload"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { SiteSection, SectionType } from "@/types/site-config"

type Props = {
  section:        SiteSection
  open:           boolean
  onOpenChange:   (open: boolean) => void
  onSave:         (section: SiteSection) => void
  onDraftChange?: (section: SiteSection) => void
  onFilePending?: (blobUrl: string, file: File, prefix: string) => void
}

export function SiteSectionSheet({ section, open, onOpenChange, onSave, onDraftChange, onFilePending }: Props) {
  const t         = useTranslations("site.sectionSheet")
  const tSections = useTranslations("site.sectionLabels")
  const sectionLabels: Record<SectionType, string> = {
    hero:       tSections("hero"),
    about:      tSections("about"),
    events:     tSections("events"),
    actualites: tSections("actualites"),
    membership: tSections("membership"),
    dons:       tSections("dons"),
    contact:    tSections("contact"),
  }
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
            <SheetTitle>{t("editTitle", { label: sectionLabels[draft.type] })}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-4 p-4 overflow-y-auto">
            {/* Title (all sections) */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sectionTitle")}</Label>
              <Input
                value={draft.title ?? ""}
                onChange={e => set("title", e.target.value)}
                placeholder={sectionLabels[draft.type]}
                maxLength={80}
              />
            </div>

            {/* Hero */}
            {draft.type === "hero" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("subtitle")}</Label>
                  <Textarea
                    value={draft.subtitle ?? ""}
                    onChange={e => set("subtitle", e.target.value as never)}
                    rows={3}
                    maxLength={300}
                    placeholder={t("subtitlePlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("heroHeight")}</Label>
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
                        {value === "full" ? t("heroHeightFull") : t("heroHeightHalf")}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("bgImage")}</Label>
                  <ImageUpload
                    value={draft.image || undefined}
                    onChange={url => set("image", url as never)}
                    prefix="site-hero"
                    aspectRatio="wide"
                    lazy
                    onFilePending={onFilePending}
                  />
                  <p className="text-xs text-muted-foreground">{t("bgImageHint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("bgColor")}</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">{t("bgColorHint")}</p>
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
                      placeholder={t("bgColorPlaceholder")}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
              </>
            )}

            {/* About */}
            {draft.type === "about" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("content")}</Label>
                <Textarea
                  value={"content" in draft ? draft.content : ""}
                  onChange={e => set("content", e.target.value as never)}
                  rows={8}
                  maxLength={5000}
                  placeholder={t("contentPlaceholder")}
                />
              </div>
            )}

            {/* Events */}
            {draft.type === "events" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("eventsLimit")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={"limit" in draft ? (draft.limit || 1) : 6}
                  onChange={e => setLimit(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("eventsLimitHint")}</p>
              </div>
            )}

            {/* Actualités */}
            {draft.type === "actualites" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("actualitesLimit")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={"limit" in draft ? (draft.limit || 1) : 6}
                  onChange={e => setLimit(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("actualitesLimitHint")}</p>
              </div>
            )}

            {/* Membership */}
            {draft.type === "membership" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("membershipIntro")}</Label>
                <Textarea
                  value={"body" in draft ? draft.body : ""}
                  onChange={e => set("body", e.target.value as never)}
                  rows={4}
                  maxLength={500}
                  placeholder={t("membershipIntroPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("membershipHint")}
                </p>
              </div>
            )}

            {/* Dons */}
            {draft.type === "dons" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("donsIntro")}</Label>
                <Textarea
                  value={"body" in draft ? draft.body : ""}
                  onChange={e => set("body", e.target.value as never)}
                  rows={4}
                  maxLength={500}
                  placeholder={t("donsIntroPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("donsHint")}
                </p>
              </div>
            )}

            {/* Contact */}
            {draft.type === "contact" && (
              <p className="text-xs text-muted-foreground">
                {t("contactHint")}
              </p>
            )}
          </div>

          <SheetFooter className="border-t px-4 py-3 shrink-0 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>{t("cancel")}</Button>
            <Button onClick={() => onSave(draft)}>{t("apply")}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t("discardTitle")}
        description={t("discardDescription")}
        confirmLabel={t("discardConfirm")}
        onConfirm={forceClose}
      />
    </>
  )
}
