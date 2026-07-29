"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PaperPlaneTiltIcon, WarningIcon, UsersIcon, TagIcon, UserCheckIcon, MagnifyingGlassIcon, CheckIcon, PencilSimpleIcon, CaretRightIcon, CircleNotchIcon, FileTextIcon, BookmarkIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useQuery } from "@tanstack/react-query"
import { useMessageTemplates, useCreateTemplate, type MessageTemplate } from "@/hooks/use-message-templates"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────────

type MembreTypeRef = { id: string; name: string; color: string }

type MembrePick = {
  id:        string
  firstName: string
  lastName:  string
  email:     string | null
  typeId:    string | null
  type:      MembreTypeRef | null
}

type RecipientMode = "all" | "type" | "manual"

// ── Helpers ────────────────────────────────────────────────────────────────────

function hasHtmlContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").trim().length > 0
}

function hasContent(subject: string, body: string): boolean {
  return subject.trim().length > 0 || hasHtmlContent(body)
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: { id: string; name: string; subject: string }
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg border p-3 transition-all text-sm",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-muted-foreground/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{template.name}</span>
        {selected && <CheckIcon className="size-3.5 text-primary shrink-0" />}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">{template.subject}</p>
    </button>
  )
}

function MemberPickList({
  membres,
  selectedIds,
  onToggle,
}: {
  membres:     MembrePick[]
  selectedIds: string[]
  onToggle:    (id: string) => void
}) {
  const t = useTranslations()
  const [search, setSearch] = useState("")

  const filtered = search.trim()
    ? membres.filter(m =>
        `${m.lastName} ${m.firstName}`.toLowerCase().includes(search.toLowerCase()) ||
        (m.email ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : membres

  const allFilteredSelected = filtered.length > 0 && filtered.every(m => selectedIds.includes(m.id))

  function toggleFiltered() {
    if (allFilteredSelected) {
      filtered.forEach(m => { if (selectedIds.includes(m.id))  onToggle(m.id) })
    } else {
      filtered.forEach(m => { if (!selectedIds.includes(m.id)) onToggle(m.id) })
    }
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="p-2 border-b bg-muted/30 space-y-2">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("membres.email.searchPlaceholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">{t("membres.email.membersCount", { count: filtered.length })}</span>
          <button type="button" onClick={toggleFiltered} className="text-xs text-primary hover:underline">
            {allFilteredSelected ? t("membres.email.deselectAll") : t("membres.email.selectAll")}
          </button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto divide-y">
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">{t("membres.email.noMemberFound")}</p>
        ) : (
          filtered.map(m => {
            const isSelected = selectedIds.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onToggle(m.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors",
                  isSelected ? "bg-primary/5" : "hover:bg-muted/40",
                )}
              >
                <span className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                  isSelected ? "bg-primary border-primary text-primary-foreground" : "border-input",
                )}>
                  {isSelected && <CheckIcon className="size-2.5" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{m.lastName} {m.firstName}</span>
                  {m.email && <span className="text-xs text-muted-foreground truncate block">{m.email}</span>}
                </span>
                {m.type && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{ background: `${m.type.color}20`, color: m.type.color }}>
                    {m.type.name}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
      <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        {selectedIds.length > 0
          ? t("membres.email.selectedCount", { count: selectedIds.length })
          : t("membres.email.noMemberSelected")}
      </div>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface SendEmailModalProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export function SendEmailModal({ open, onOpenChange }: SendEmailModalProps) {
  const t = useTranslations()
  const [step,              setStep]              = useState<"compose" | "confirm">("compose")
  const [recipientMode,     setRecipientMode]     = useState<RecipientMode>("all")
  const [selectedTypeId,    setSelectedTypeId]    = useState<string>("")
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [selectedTemplate,    setSelectedTemplate]    = useState<MessageTemplate | null>(null)
  const [pendingTemplate,     setPendingTemplate]     = useState<MessageTemplate | null>(null)
  const [appliedBodyBaseline, setAppliedBodyBaseline] = useState<string>("")
  const captureNextBody = useRef(false)
  const [closeWarningOpen,    setCloseWarningOpen]    = useState(false)
  const [saveTemplateOpen,    setSaveTemplateOpen]    = useState(false)
  const [saveTemplateName,    setSaveTemplateName]    = useState("")
  const [subject,           setSubject]           = useState("")
  const [bodyHtml,          setBodyHtml]          = useState("")
  const [sending,           setSending]           = useState(false)
  const [countLoading,      setCountLoading]      = useState(false)
  const [recipientCount,    setRecipientCount]    = useState<number | null>(null)

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setStep("compose")
      setRecipientMode("all")
      setSelectedTypeId("")
      setSelectedMemberIds([])
      setSelectedTemplate(null)
      setPendingTemplate(null)
      setAppliedBodyBaseline("")
      captureNextBody.current = false
      setCloseWarningOpen(false)
      setSaveTemplateOpen(false)
      setSaveTemplateName("")
      setSubject("")
      setBodyHtml("")
      setRecipientCount(null)
      setCountLoading(false)
    }
  }, [open])

  // Reset recipient count when selection changes so stale count isn't shown
  useEffect(() => { setRecipientCount(null) }, [recipientMode, selectedTypeId])

  const { data: types = [] } = useQuery<MembreTypeRef[]>({
    queryKey: ["membre-types"],
    queryFn:  () => fetch("/api/membre-types").then(r => r.json()),
    enabled:  open,
  })

  const { data: templates = [], isLoading: loadingTemplates } = useMessageTemplates({ enabled: open })
  const createTemplate = useCreateTemplate()

  const { data: allMembres = [], isLoading: loadingMembres } = useQuery<MembrePick[]>({
    queryKey:  ["membres-email-pick"],
    queryFn:   () => fetch("/api/membres?status=ACTIF").then(r => r.json()),
    enabled:   open && recipientMode === "manual",
    staleTime: 30_000,
  })
  const membresWithEmail = allMembres.filter(m => m.email)

  // Computed — no need for state + effect
  const selectedTypeName = types.find(t => t.id === selectedTypeId)?.name ?? ""

  // Uses the TipTap-normalized baseline captured on apply, not the raw DB string
  const contentMatchesTemplate =
    !!selectedTemplate &&
    subject === selectedTemplate.subject &&
    bodyHtml === appliedBodyBaseline

  function applyTemplate(tpl: MessageTemplate) {
    // Warn whenever there's content that differs from what this template would set
    if (hasContent(subject, bodyHtml) && !contentMatchesTemplate) {
      setPendingTemplate(tpl)
      return
    }
    doApplyTemplate(tpl)
  }

  function doApplyTemplate(tpl: MessageTemplate) {
    setSelectedTemplate(tpl)
    setSubject(tpl.subject)
    captureNextBody.current = true
    setBodyHtml(tpl.body)
    setPendingTemplate(null)
  }

  function handleBodyChange(html: string) {
    setBodyHtml(html)
    if (captureNextBody.current) {
      setAppliedBodyBaseline(html)
      captureNextBody.current = false
    }
  }

  function clearTemplate() {
    setSelectedTemplate(null)
  }

  async function handleSaveAsTemplate() {
    const name = saveTemplateName.trim()
    if (!name) return
    try {
      const saved = await createTemplate.mutateAsync({ name, subject, body: bodyHtml })
      setSelectedTemplate(saved)
      setAppliedBodyBaseline(bodyHtml)
      toast.success(t("membres.email.toasts.templateSaved", { name }))
      setSaveTemplateOpen(false)
      setSaveTemplateName("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  function toggleMember(id: string) {
    setSelectedMemberIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleContinue() {
    if (recipientMode === "type" && !selectedTypeId) {
      toast.error(t("membres.email.toasts.selectType"))
      return
    }
    if (recipientMode === "manual" && selectedMemberIds.length === 0) {
      toast.error(t("membres.email.toasts.selectMember"))
      return
    }
    if (!subject.trim()) {
      toast.error(t("membres.email.toasts.subjectRequired"))
      return
    }
    if (!hasHtmlContent(bodyHtml)) {
      toast.error(t("membres.email.toasts.bodyRequired"))
      return
    }

    if (recipientMode === "manual") {
      setRecipientCount(selectedMemberIds.length)
      setStep("confirm")
      return
    }

    setCountLoading(true)
    try {
      const qs    = recipientMode === "type" ? `?typeId=${selectedTypeId}` : ""
      const res   = await fetch(`/api/membres/email/count${qs}`)
      const d     = await res.json()
      const count = d.count ?? 0

      if (count === 0) {
        toast.error(t("membres.email.toasts.noRecipientWithEmail"))
        return
      }

      setRecipientCount(count)
      setStep("confirm")
    } catch {
      toast.error(t("membres.email.toasts.cannotVerifyCount"))
    } finally {
      setCountLoading(false)
    }
  }

  async function handleSend() {
    setSending(true)
    try {
      const body: Record<string, unknown> = { subject, bodyHtml }
      if (recipientMode === "manual")                 body.recipientIds = selectedMemberIds
      if (recipientMode === "type" && selectedTypeId) body.typeId       = selectedTypeId

      const res  = await fetch("/api/membres/email", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t("common.error")); return }
      if (data.sent === 0) {
        toast.error(data.failed > 0
          ? t("membres.email.toasts.noEmailSentWithFailures", { count: data.failed })
          : t("membres.email.toasts.noEmailSent"))
      } else {
        // "Envoyé" here only means Resend accepted the request — it doesn't guarantee
        // the message was actually delivered (bounces/erreurs surface later, async, via
        // webhook). The real per-recipient outcome is visible in each member's Emails tab.
        toast.success(t("membres.email.toasts.emailSent", { count: data.sent }))
        if (data.failed > 0) {
          const names: string[] = (data.failedMembers ?? []).map((m: { name: string }) => m.name)
          const preview = names.slice(0, 5).join(", ") + (names.length > 5 ? t("membres.email.toasts.andOthers", { count: names.length - 5 }) : "")
          toast.warning(
            t("membres.email.toasts.sendFailures", { count: data.failed, preview: preview ? ` : ${preview}` : "" }),
          )
        }
      }
      onOpenChange(false)
    } catch {
      toast.error(t("common.networkError"))
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    if (sending) return
    if (hasContent(subject, bodyHtml)) {
      setCloseWarningOpen(true)
      return
    }
    onOpenChange(false)
  }

  const recipientSummary =
    recipientMode === "manual"
      ? t("membres.email.selectedCount", { count: selectedMemberIds.length })
      : recipientMode === "type" && selectedTypeName
        ? t("membres.email.recipientsOfType", { count: recipientCount ?? 0, type: selectedTypeName })
        : t("membres.email.recipientsActive", { count: recipientCount ?? 0 })

  return (
    <>
      <Modal
        open={open}
        onOpenChange={handleClose}
        title={t("membres.email.title")}
        size="lg"
        dismissable={!sending}
      >
        {step === "compose" ? (
          <div className="space-y-5">

            {/* ── Recipients ── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("membres.email.recipients")}</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { mode: "all",    icon: UsersIcon,     label: t("membres.email.modeAll") },
                  { mode: "type",   icon: TagIcon,       label: t("membres.email.modeType") },
                  { mode: "manual", icon: UserCheckIcon, label: t("membres.email.modeManual") },
                ] as const).map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRecipientMode(mode)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all",
                      recipientMode === mode
                        ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </div>

              {recipientMode === "all" && (
                <p className="text-xs text-muted-foreground">
                  {t("membres.email.allModeNotice")}
                </p>
              )}

              {recipientMode === "type" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t("membres.email.typeLabel")} <span className="text-red-500">*</span></p>
                  {types.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">{t("membres.email.noTypeConfigured")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {types.map(type => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => setSelectedTypeId(type.id === selectedTypeId ? "" : type.id)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                            selectedTypeId === type.id
                              ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                              : "border-border text-muted-foreground hover:border-muted-foreground/40",
                          )}
                        >
                          <span className="size-2 rounded-full shrink-0" style={{ background: type.color }} />
                          {type.name}
                          {selectedTypeId === type.id && <CheckIcon className="size-3 ml-0.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {recipientMode === "manual" && (
                loadingMembres ? (
                  <div className="h-40 rounded-lg bg-muted animate-pulse" />
                ) : membresWithEmail.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic text-center py-4">
                    {t("membres.email.noActiveMemberWithEmail")}
                  </p>
                ) : (
                  <MemberPickList
                    membres={membresWithEmail}
                    selectedIds={selectedMemberIds}
                    onToggle={toggleMember}
                  />
                )
              )}
            </div>

            <div className="border-t" />

            {/* ── Templates ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("membres.email.templateSectionLabel")}</p>
                {selectedTemplate && (
                  <button
                    type="button"
                    onClick={clearTemplate}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t("membres.email.deselectTemplate")}
                  </button>
                )}
              </div>

              {loadingTemplates ? (
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map(i => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}
                </div>
              ) : templates.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  <FileTextIcon className="size-5 shrink-0 text-muted-foreground/40" />
                  <span>
                    {t("membres.email.noTemplateCreated")}{" "}
                    <Link href="/dashboard/messages" className="text-primary hover:underline" onClick={() => onOpenChange(false)}>
                      {t("membres.email.createTemplateLink")}
                    </Link>
                    {t("membres.email.inMessagesSection")}
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-0.5">
                  {templates.map(tpl => (
                    <TemplateCard
                      key={tpl.id}
                      template={tpl}
                      selected={selectedTemplate?.id === tpl.id}
                      onSelect={() => applyTemplate(tpl)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t" />

            {/* ── Message ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("membres.email.messageSectionLabel")}</p>
                {subject.trim().length > 0 && hasHtmlContent(bodyHtml) && !contentMatchesTemplate && (
                  <button
                    type="button"
                    onClick={() => { setSaveTemplateName(subject.trim()); setSaveTemplateOpen(true) }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <BookmarkIcon className="size-3.5" />
                    {t("membres.email.saveAsTemplate")}
                  </button>
                )}
              </div>
              <FormField
                label={t("membres.email.subjectLabel")}
                required
                placeholder={t("membres.email.subjectPlaceholder")}
                value={subject}
                onChange={e => setSubject(e.target.value)}
              />
              <RichTextEditor
                label={t("membres.email.bodyLabel")}
                required
                value={bodyHtml}
                onChange={handleBodyChange}
                placeholder={t("membres.email.bodyPlaceholder")}
                minHeight="180px"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleClose}>{t("common.cancel")}</Button>
              <Button onClick={handleContinue} disabled={countLoading}>
                {countLoading
                  ? <CircleNotchIcon className="mr-1.5 size-4 animate-spin" />
                  : <CaretRightIcon className="mr-1.5 size-4" />
                }
                {t("membres.email.continue")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 flex gap-3">
              <WarningIcon className="size-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t("membres.email.confirmSendTitle")}</p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {t("membres.email.confirmSendDescription", { recipients: recipientSummary })}
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">{t("membres.email.subjectLabel")}</p>
                <p className="text-sm font-medium">{subject}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">{t("membres.email.recipients")}</p>
                <p className="text-sm font-medium">{recipientSummary}</p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("compose")} disabled={sending}>
                <PencilSimpleIcon className="mr-1.5 size-3.5" />
                {t("common.edit")}
              </Button>
              <Button onClick={handleSend} loading={sending}>
                <PaperPlaneTiltIcon className="mr-1.5 size-4" />
                {t("membres.email.sendNow")}
              </Button>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={!!pendingTemplate}
          onOpenChange={open => { if (!open) setPendingTemplate(null) }}
          title={t("membres.email.replaceContentTitle")}
          description={t("membres.email.replaceContentDescription")}
          confirmLabel={t("membres.email.replace")}
          onConfirm={() => { if (pendingTemplate) doApplyTemplate(pendingTemplate) }}
        />
      </Modal>

      <ConfirmDialog
        open={closeWarningOpen}
        onOpenChange={setCloseWarningOpen}
        title={t("membres.email.discardTitle")}
        description={t("membres.email.discardDescription")}
        confirmLabel={t("membres.email.discard")}
        onConfirm={() => { setCloseWarningOpen(false); onOpenChange(false) }}
      />

      <Modal
        open={saveTemplateOpen}
        onOpenChange={open => { if (!open) setSaveTemplateOpen(false) }}
        title={t("membres.email.saveAsTemplate")}
        size="sm"
      >
        <div className="space-y-4">
          <FormField
            label={t("membres.email.templateNameLabel")}
            required
            placeholder={t("membres.email.templateNamePlaceholder")}
            value={saveTemplateName}
            onChange={e => setSaveTemplateName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSaveAsTemplate() }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSaveTemplateOpen(false)} disabled={createTemplate.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSaveAsTemplate}
              loading={createTemplate.isPending}
              disabled={!saveTemplateName.trim()}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
