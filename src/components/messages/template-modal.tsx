"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { ChatTextIcon, PaperPlaneTiltIcon, EyeIcon, TextTIcon, SquaresFourIcon, CrownIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { VariableTokenChips, getEmailVariableTokens } from "@/components/messages/variable-token-chips"
import { EmailBlockEditor, type EmailBlockEditorHandle } from "@/components/messages/email-block-editor"
import { useModules, useCanUseCustomBranding } from "@/lib/user-context"
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/automation"
import { findIncompleteBlock, type EmailBlock } from "@/lib/email-blocks"
import { sanitizeEmailPreviewHtml } from "@/lib/sanitize-email-preview"
import { cn } from "@/lib/utils"
import {
  useCreateTemplate, useUpdateTemplate, useTestSendTemplate,
  type MessageTemplate, type TemplateInput,
} from "@/hooks/use-message-templates"

type ContentMode = "text" | "blocks"

function hasText(html: string) {
  return html.replace(/<[^>]*>/g, "").trim().length > 0
}

function getTemplateCategoryLabels(t: ReturnType<typeof useTranslations>): Record<TemplateCategory, string> {
  return {
    GENERAL:     t("messages.categories.general"),
    COTISATION:  t("messages.categories.cotisation"),
    EVENEMENT:   t("messages.categories.evenement"),
    MEMBRE:      t("messages.categories.membre"),
    FACTURATION: t("messages.categories.facturation"),
  }
}

// `body` is validated separately in onSubmit rather than here — in "blocks" mode it isn't
// what actually holds the content (EmailBlockEditor's own state does), so a hasText check on
// it here would either wrongly block submit or wrongly allow an empty design through.
function buildSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    name:      z.string().min(1, t("messages.templateModal.validation.required")),
    category:  z.enum(TEMPLATE_CATEGORIES),
    subject:   z.string().min(1, t("messages.templateModal.validation.required")),
    body:      z.string().optional(),
    smsBody:   z.string().optional(),
    isDefault: z.boolean(),
  })
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  template?:    MessageTemplate | null
}

export function TemplateModal({ open, onOpenChange, template }: Props) {
  const t = useTranslations()
  const templateCategoryLabels = getTemplateCategoryLabels(t)
  const categoryOptions = TEMPLATE_CATEGORIES.map(value => ({ value, label: templateCategoryLabels[value] }))
  const variables = getEmailVariableTokens(t)

  const isEditing = !!template
  const { sms }   = useModules()
  // Same Pro gate as the branding settings screen (logo/color/sender/signature) — "Design
  // visual" is custom branding too, just applied to a template instead of every email's
  // header. See CanUseCustomBrandingContext in src/lib/user-context.tsx for how this is
  // resolved (Pro by default, or a staff-set backoffice override).
  const canUseBlocks = useCanUseCustomBranding()
  const createMut = useCreateTemplate()
  const updateMut = useUpdateTemplate(template?.id ?? "")
  const testMut   = useTestSendTemplate()
  const [previewOpen, setPreviewOpen] = useState(false)

  // Locked to whatever an existing template already is once editing — no lossy conversion
  // between a Tiptap body and a block list. Only choosable up front, when creating new.
  const [mode, setMode]     = useState<ContentMode>(template?.blocks ? "blocks" : "text")
  const [blocks, setBlocks] = useState<EmailBlock[]>(template?.blocks ?? [])
  const blockEditorRef      = useRef<EmailBlockEditorHandle>(null)

  const { register, handleSubmit, reset, setValue, watch, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver:      zodResolver(buildSchema(t)),
    defaultValues: { name: "", category: "GENERAL", subject: "", body: "", smsBody: "", isDefault: false },
  })

  useEffect(() => {
    if (open) {
      reset(template
        ? { name: template.name, category: template.category, subject: template.subject, body: template.body, smsBody: template.smsBody ?? "", isDefault: template.isDefault }
        : { name: "", category: "GENERAL", subject: "", body: "", smsBody: "", isDefault: false }
      )
      setMode(template?.blocks ? "blocks" : "text")
      setBlocks(template?.blocks ?? [])
    }
  }, [open, template, reset])

  async function onSubmit(data: FormValues) {
    if (mode === "text" && !hasText(data.body ?? "")) {
      toast.error(t("messages.templateModal.validation.required"))
      return
    }
    if (mode === "blocks" && blocks.length === 0) {
      toast.error(t("messages.blockEditor.empty"))
      return
    }
    if (mode === "blocks" && findIncompleteBlock(blocks)) {
      toast.error(t("messages.blockEditor.incomplete"))
      return
    }
    // Any image block still holding a blob: preview gets uploaded to R2 here — right before
    // the template is actually persisted, not when each file was picked (see
    // EmailBlockEditorHandle's own comment for why). A blob: URL can't survive into the saved
    // template: it's only valid in this browser tab, and would be a broken <img> for anyone
    // who actually receives the email.
    let finalBlocks = blocks
    if (mode === "blocks") {
      try {
        finalBlocks = await blockEditorRef.current!.resolvePendingUploads()
        setBlocks(finalBlocks) // keeps the editor's own preview in sync now that the blob: URLs it held are revoked
      } catch {
        toast.error(t("messages.blockEditor.uploadError"))
        return
      }
    }
    const payload: TemplateInput = {
      name:      data.name,
      category:  data.category,
      subject:   data.subject,
      ...(mode === "blocks" ? { blocks: finalBlocks } : { body: data.body }),
      smsBody:   data.smsBody?.trim() || undefined,
      isDefault: data.isDefault,
    }
    try {
      if (isEditing) {
        await updateMut.mutateAsync(payload)
        toast.success(t("messages.templateModal.toasts.updated"))
      } else {
        await createMut.mutateAsync(payload)
        toast.success(t("messages.templateModal.toasts.created"))
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleTestSend() {
    try {
      const res = await testMut.mutateAsync(template!.id) as { sentTo: string }
      toast.success(t("messages.templateModal.toasts.testSent", { email: res.sentTo }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const subject   = watch("subject")
  const bodyHtml  = watch("body") ?? ""
  const smsBody   = watch("smsBody") ?? ""
  const isPending = isSubmitting || createMut.isPending || updateMut.isPending

  // Renders through the exact same wrapper every real send goes through (customEmail() →
  // layout()), with this association's actual current header/footer/signature — not just
  // the body content in isolation. Fetched fresh each time the preview opens (draft content
  // can have changed since the last open) via /api/message-templates/preview, which needs
  // the sandboxed-iframe treatment a historical sent email gets too (membre-email-log.tsx):
  // it's full email HTML (tables, images, inline-styled buttons), not the kind of hand-
  // authored fragment RichTextView's DOMPurify allowlist is built for.
  const [previewSubject, setPreviewSubject]     = useState<string | null>(null)
  const [previewHtml, setPreviewHtml]           = useState<string | null>(null)
  const [previewLoading, setPreviewLoading]     = useState(false)

  async function openPreview() {
    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewSubject(null) // clears whatever the previous open showed, so a re-open never flashes stale content before the fresh fetch lands
    setPreviewHtml(null)
    try {
      // Blocks mode: swap any still-unsaved image's blob: URL for a data: URI first (see
      // EmailBlockEditorHandle.getPreviewBlocks) — the preview endpoint's sandboxed iframe
      // can't resolve a blob: URL created outside itself, and uploading to R2 just to preview
      // a draft that might never get saved would reintroduce the orphaned-file problem
      // resolvePendingUploads (the actual save path) exists to avoid.
      const previewBlocks = mode === "blocks" ? await blockEditorRef.current?.getPreviewBlocks() : undefined
      const res = await fetch("/api/message-templates/preview", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          subject,
          ...(mode === "blocks" ? { blocks: previewBlocks ?? blocks } : { body: bodyHtml }),
        }),
      })
      if (!res.ok) throw new Error()
      const { subject: renderedSubject, html } = (await res.json()) as { subject: string; html: string }
      setPreviewSubject(renderedSubject)
      setPreviewHtml(await sanitizeEmailPreviewHtml(html))
    } catch {
      toast.error(t("common.error"))
      setPreviewOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? t("messages.templateModal.editTitle") : t("messages.templateModal.newTitle")}
      size="2xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label={t("messages.templateModal.internalName")}
            required
            placeholder={t("messages.templateModal.internalNamePlaceholder")}
            error={errors.name?.message}
            {...register("name")}
          />
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <SelectField
                label={t("messages.templateModal.category")}
                options={categoryOptions}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        </div>
        <FormField
          label={t("messages.templateModal.emailSubject")}
          required
          placeholder={t("messages.templateModal.emailSubjectPlaceholder")}
          error={errors.subject?.message}
          {...register("subject")}
        />

        {!isEditing && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("text")}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                mode === "text" ? "border-foreground/30 bg-muted/40" : "hover:bg-muted/20",
              )}
            >
              <span className="flex items-center gap-1.5 font-medium"><TextTIcon className="size-4" /> {t("messages.templateModal.modeText")}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{t("messages.templateModal.modeTextHint")}</span>
            </button>
            <button
              type="button"
              disabled={!canUseBlocks}
              onClick={() => setMode("blocks")}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                !canUseBlocks
                  ? "cursor-not-allowed opacity-60"
                  : mode === "blocks" ? "border-foreground/30 bg-muted/40" : "hover:bg-muted/20",
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <SquaresFourIcon className="size-4" /> {t("messages.templateModal.modeBlocks")}
                {!canUseBlocks && <CrownIcon className="size-3.5 text-amber-500" />}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {canUseBlocks ? t("messages.templateModal.modeBlocksHint") : t("messages.templateModal.modeBlocksProOnly")}
              </span>
            </button>
          </div>
        )}

        {mode === "text" ? (
          <>
            {isEditing && (
              <p className="text-xs text-muted-foreground">{t("messages.templateModal.modeLockedHint")}</p>
            )}
            <VariableTokenChips tokens={variables} hint={t("messages.templateModal.variablesHint")} />
            <RichTextEditor
              label={t("messages.templateModal.emailBody")}
              required
              value={bodyHtml}
              onChange={v => setValue("body", v, { shouldValidate: true })}
              placeholder={t("messages.templateModal.emailBodyPlaceholder")}
              minHeight="200px"
              error={errors.body?.message}
            />
          </>
        ) : (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("messages.templateModal.emailBody")}</label>
            {isEditing && (
              <p className="text-xs text-muted-foreground">{t("messages.templateModal.modeLockedHint")}</p>
            )}
            <EmailBlockEditor ref={blockEditorRef} blocks={blocks} onChange={setBlocks} />
          </div>
        )}

        <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer">
          <input
            type="checkbox"
            {...register("isDefault")}
            className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border border-input accent-primary"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">{t("messages.templateModal.isDefault")}</span>
            <span className="block text-xs text-muted-foreground">{t("messages.templateModal.isDefaultHint")}</span>
          </span>
        </label>

        {sms && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <ChatTextIcon className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">{t("messages.templateModal.smsBody")}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t("messages.templateModal.smsBodyHint")}</p>
            <textarea
              {...register("smsBody")}
              rows={3}
              placeholder={t("messages.templateModal.smsBodyPlaceholder")}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className={`text-xs text-right ${smsBody.length > 160 ? "text-amber-600" : "text-muted-foreground"}`}>
              {t("messages.templateModal.smsCharCount", { count: smsBody.length })}{smsBody.length > 160 ? t("messages.templateModal.smsWillSplit") : ""}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" loading={previewLoading} onClick={openPreview}>
              <EyeIcon className="mr-1.5 size-3.5" /> {t("messages.templateModal.preview")}
            </Button>
            {isEditing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={testMut.isPending}
                title={t("messages.templateModal.testTooltip")}
                onClick={handleTestSend}
              >
                <PaperPlaneTiltIcon className="mr-1.5 size-3.5" /> {t("messages.templateModal.test")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={isPending}>
              {isEditing ? t("common.save") : t("messages.templateModal.create")}
            </Button>
          </div>
        </div>
      </form>

      <Modal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={t("messages.templateModal.previewTitle")}
        description={t("messages.templateModal.previewDescription")}
        size="lg"
      >
        <div className="space-y-3">
          {previewSubject != null && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t("messages.templateModal.previewSubject")}</p>
              <p className="text-sm font-medium">{previewSubject}</p>
            </div>
          )}
          {previewHtml && (
            <>
              <iframe
                srcDoc={previewHtml}
                sandbox=""
                referrerPolicy="no-referrer"
                title={t("messages.templateModal.previewTitle")}
                className="w-full h-96 rounded-md border bg-white"
              />
              <p className="text-xs text-muted-foreground">
                {t("messages.templateModal.previewBrandingHint")}{" "}
                <Link href="/dashboard/parametres" className="underline underline-offset-2 hover:text-foreground">
                  {t("messages.templateModal.previewBrandingLink")}
                </Link>
              </p>
            </>
          )}
        </div>
      </Modal>
    </Modal>
  )
}
