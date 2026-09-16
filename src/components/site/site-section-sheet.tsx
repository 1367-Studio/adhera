"use client"

import { useState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { ImageUpload } from "@/components/ui/image-upload"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SiteAiFieldButton } from "./site-ai-field-button"
import type { SiteSection, SectionType, DonsSection, DonationFormPick } from "@/types/site-config"
import { toHtml } from "@/lib/site-content"
import { BASE_PATH } from "@/lib/env"
import { useDonationForms } from "@/hooks/use-donation-forms"
import { resolveDonationFormBySection, usesDonationForms } from "@/lib/dons/site-section-picks"

type Props = {
  section:        SiteSection
  // The builder's current sections (drafts included) — the dons form picker needs them to
  // know which form each other "dons" section shows.
  sections:       SiteSection[]
  open:           boolean
  aiEnabled:      boolean
  donsModuleEnabled: boolean
  onOpenChange:   (open: boolean) => void
  onSave:         (section: SiteSection) => void
  onDraftChange?: (section: SiteSection) => void
  onFilePending?: (blobUrl: string, file: File, prefix: string) => void
}

export function SiteSectionSheet({ section, sections, open, aiEnabled, donsModuleEnabled, onOpenChange, onSave, onDraftChange, onFilePending }: Props) {
  const t         = useTranslations("site.sectionSheet")
  const tSections = useTranslations("site.sectionLabels")
  const sectionLabels: Record<SectionType, string> = {
    hero:       tSections("hero"),
    about:      tSections("about"),
    events:     tSections("events"),
    actualites: tSections("actualites"),
    membership: tSections("membership"),
    dons:       tSections("dons"),
    boutique:   tSections("boutique"),
    contact:    tSections("contact"),
  }
  const [draft, setDraft]           = useState<SiteSection>(section)
  const [confirmClose, setConfirmClose] = useState(false)
  // Distinguishes a real edit (via set()) from draft merely being resynced to a new/unchanged
  // `section` prop — only the former should notify the parent. Without this, simply opening an
  // existing section (mount syncs draft to section, which is a no-op — same reference — so no
  // effect fires) is harmless, but *switching* to a different section while the sheet is still
  // mounted (editingSection changes, no remount) would otherwise re-fire onDraftChange with the
  // new section's own untouched data, wrongly marking the site config dirty from a plain click.
  const editedRef = useRef(false)

  useEffect(() => {
    editedRef.current = false
    setDraft(section)
  }, [section])

  // Notified after render, not synchronously inside setDraft's updater (which used to call
  // onDraftChange there) — that path is "setState on SiteView while SiteSectionSheet renders",
  // a genuine React warning (Cannot update a component while rendering a different component).
  // Deliberately keyed only on `draft`: onDraftChange's identity changes on every parent
  // re-render this triggers (SiteControlsPanel's onDraftChange is a useCallback over
  // config.sections), so including it here would re-fire on renders where nothing local
  // actually changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (editedRef.current) onDraftChange?.(draft) }, [draft])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set(key: string, value: any) {
    editedRef.current = true
    setDraft(prev => ({ ...prev, [key]: value }) as SiteSection)
  }

  // AI-generated fields only ever include the ones relevant to draft.type (see
  // buildSectionPrompt/SECTION_FIELD_RULES in the API route) — apply whichever of them the
  // response actually returned, leaving every other field (image, bgColor, limit, heroHeight…)
  // untouched.
  function applyAiResult(result: { title: string; subtitle?: string; content?: string; body?: string; buttonLabel?: string }) {
    set("title", result.title)
    if (draft.type === "hero" && result.subtitle !== undefined) set("subtitle", result.subtitle)
    if (draft.type === "about" && result.content !== undefined) set("content", result.content)
    if ((draft.type === "dons" || draft.type === "membership") && result.body !== undefined) set("body", result.body)
    if (draft.type === "dons" && result.buttonLabel !== undefined) set("buttonLabel", result.buttonLabel)
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
            <div className="flex items-center gap-2">
              <SheetTitle className="flex-1">{t("editTitle", { label: sectionLabels[draft.type] })}</SheetTitle>
              {aiEnabled && <SiteAiFieldButton scope="section" sectionType={draft.type} onApply={applyAiResult} />}
            </div>
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
              <RichTextEditor
                label={t("content")}
                value={toHtml("content" in draft ? draft.content : "")}
                onChange={v => set("content", v)}
                placeholder={t("contentPlaceholder")}
                minHeight="180px"
              />
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
                <RichTextEditor
                  label={t("membershipIntro")}
                  value={toHtml("body" in draft ? draft.body : "")}
                  onChange={v => set("body", v)}
                  placeholder={t("membershipIntroPlaceholder")}
                  minHeight="120px"
                />
                <p className="text-xs text-muted-foreground">
                  {t("membershipHint")}
                </p>
              </div>
            )}

            {/* Dons */}
            {draft.type === "dons" && (
              <div className="space-y-4">
                <DonsFormField
                  section={draft}
                  sections={sections}
                  donsModuleEnabled={donsModuleEnabled}
                  sectionLabel={sectionLabels.dons}
                  onPick={formId => set("donationFormPick", { formId, pickedAt: Date.now() } satisfies DonationFormPick)}
                />
                <RichTextEditor
                  label={t("donsIntro")}
                  value={toHtml("body" in draft ? draft.body : "")}
                  onChange={v => set("body", v)}
                  placeholder={t("donsIntroPlaceholder")}
                  minHeight="120px"
                />
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("donsButtonLabel")}</Label>
                  <Input
                    value={"buttonLabel" in draft ? (draft.buttonLabel ?? "") : ""}
                    onChange={e => set("buttonLabel", e.target.value)}
                    maxLength={40}
                    placeholder={t("donsButtonLabelPlaceholder")}
                  />
                </div>
              </div>
            )}

            {/* Boutique */}
            {draft.type === "boutique" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("boutiqueLimit")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={"limit" in draft ? (draft.limit || 1) : 6}
                  onChange={e => setLimit(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("boutiqueLimitHint")}</p>
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

// Select value standing for "Aucun formulaire" — Base UI's Select needs a string value, and a
// cuid form id can never collide with it.
const NO_DONATION_FORM_VALUE = "none"

// Picks which published DonationForm this "dons" block links to. Only drafts the choice
// (onPick → donationFormPick on the section): the site's own save applies it to the forms.
function DonsFormField({ section, sections, donsModuleEnabled, sectionLabel, onPick }: {
  section:           DonsSection
  sections:          SiteSection[]
  donsModuleEnabled: boolean
  sectionLabel:      string
  onPick:            (formId: string | null) => void
}) {
  const t         = useTranslations("site.sectionSheet")
  const tControls = useTranslations("site.controls")
  const tCommon   = useTranslations("common")
  const { data: donationForms } = useDonationForms({ enabled: donsModuleEnabled })

  function field(control: React.ReactNode) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{t("donsForm")}</Label>
        {control}
      </div>
    )
  }

  if (!donsModuleEnabled)
    return field(<p className="text-xs text-amber-600 dark:text-amber-400">{tControls("donsModuleDisabled")}</p>)

  if (!donationForms) {
    return field(
      <Select disabled>
        <SelectTrigger className="w-full">
          <SelectValue>{tCommon("loading")}</SelectValue>
        </SelectTrigger>
      </Select>,
    )
  }

  const manageLink = (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0"
      nativeButton={false}
      render={<a href={`${BASE_PATH}/dashboard/dons?tab=formulaires`} target="_blank" rel="noopener noreferrer" />}
    >
      {t("donsFormManageLink")}
      <ArrowSquareOutIcon className="size-3.5" />
    </Button>
  )

  // Already newest first (the list API orders by createdAt desc). PRIVATE forms are offered
  // too — picking one is an explicit choice to put it on the site.
  const publishedForms = donationForms.filter(form => form.status === "PUBLISHED")
  if (publishedForms.length === 0) {
    return field(
      <>
        <p className="text-xs text-muted-foreground">
          {usesDonationForms(donationForms) ? t("donsFormEmptyNoPublished") : t("donsFormEmptyLegacy")}
        </p>
        {manageLink}
      </>,
    )
  }

  // The parent's copy of this section only catches up after onDraftChange's effect runs, so
  // resolve against this sheet's own draft.
  const currentSections = sections.some(existingSection => existingSection.id === section.id)
    ? sections.map(existingSection => existingSection.id === section.id ? section : existingSection)
    : [...sections, section]
  const selectedForm = resolveDonationFormBySection(currentSections, donationForms)[section.id] ?? null

  // The section the selected form gets taken from: where it would show without this pick.
  const withoutThisPick = resolveDonationFormBySection(
    currentSections.map(existingSection => existingSection.id === section.id ? { ...section, donationFormPick: undefined } : existingSection),
    donationForms,
  )
  const previousSection = selectedForm && section.donationFormPick
    ? currentSections.find(existingSection =>
        existingSection.id !== section.id && withoutThisPick[existingSection.id]?.id === selectedForm.id)
    : undefined

  return field(
    <>
      <Select
        value={selectedForm?.id ?? NO_DONATION_FORM_VALUE}
        onValueChange={value => { if (value !== null) onPick(value === NO_DONATION_FORM_VALUE ? null : value) }}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{selectedForm?.title ?? t("donsFormNone")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_DONATION_FORM_VALUE}>{t("donsFormNone")}</SelectItem>
          <SelectSeparator />
          {publishedForms.map(form => (
            <SelectItem key={form.id} value={form.id}>{form.title}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {selectedForm ? t("donsFormSelectedHint") : t("donsFormNoneHint")}
      </p>
      {previousSection && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("donsFormMovedWarning", { section: previousSection.title || sectionLabel })}
        </p>
      )}
    </>,
  )
}
