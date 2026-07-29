"use client"

import { useEffect, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { DotsSixIcon, ChatTextIcon, PaperPlaneTiltIcon, EyeIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { RichTextView } from "@/components/ui/rich-text-view"
import { useModules } from "@/lib/user-context"
import { substituteVars, buildVars, TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/automation"
import {
  useCreateTemplate, useUpdateTemplate, useTestSendTemplate,
  type MessageTemplate, type TemplateInput,
} from "@/hooks/use-message-templates"

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

function buildSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    name:     z.string().min(1, t("messages.templateModal.validation.required")),
    category: z.enum(TEMPLATE_CATEGORIES),
    subject:  z.string().min(1, t("messages.templateModal.validation.required")),
    body:     z.string().refine(hasText, t("messages.templateModal.validation.required")),
    smsBody:  z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>

const PREVIEW_VARS = buildVars({
  prenom:            "Prénom",
  nom:               "Nom",
  email:             "prenom.nom@example.com",
  association:       "Votre association",
  slug:              "demo",
  anneeCotisation:   new Date().getFullYear(),
  montantCotisation: "50",
  titreEvenement:    "Événement de test",
  dateEvenement:     new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
  lieuEvenement:     "Salle des fêtes",
})

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  template?:    MessageTemplate | null
}

export function TemplateModal({ open, onOpenChange, template }: Props) {
  const t = useTranslations()
  const templateCategoryLabels = getTemplateCategoryLabels(t)
  const categoryOptions = TEMPLATE_CATEGORIES.map(value => ({ value, label: templateCategoryLabels[value] }))
  const variables = [
    { token: "{{prenom}}",             label: t("messages.templateModal.variables.prenom") },
    { token: "{{nom}}",                label: t("messages.templateModal.variables.nom") },
    { token: "{{nom_complet}}",        label: t("messages.templateModal.variables.nomComplet") },
    { token: "{{email}}",              label: t("messages.templateModal.variables.email") },
    { token: "{{association}}",        label: t("messages.templateModal.variables.association") },
    { token: "{{lien_portal}}",        label: t("messages.templateModal.variables.lienPortal") },
    { token: "{{annee_cotisation}}",   label: t("messages.templateModal.variables.anneeCotisation") },
    { token: "{{montant_cotisation}}", label: t("messages.templateModal.variables.montantCotisation") },
    { token: "{{titre_evenement}}",    label: t("messages.templateModal.variables.titreEvenement") },
    { token: "{{date_evenement}}",     label: t("messages.templateModal.variables.dateEvenement") },
    { token: "{{lieu_evenement}}",     label: t("messages.templateModal.variables.lieuEvenement") },
  ]

  const isEditing = !!template
  const { sms }   = useModules()
  const createMut = useCreateTemplate()
  const updateMut = useUpdateTemplate(template?.id ?? "")
  const testMut   = useTestSendTemplate()
  const [previewOpen, setPreviewOpen] = useState(false)

  const { register, handleSubmit, reset, setValue, watch, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver:      zodResolver(buildSchema(t)),
    defaultValues: { name: "", category: "GENERAL", subject: "", body: "", smsBody: "" },
  })

  useEffect(() => {
    if (open) {
      reset(template
        ? { name: template.name, category: template.category, subject: template.subject, body: template.body, smsBody: template.smsBody ?? "" }
        : { name: "", category: "GENERAL", subject: "", body: "", smsBody: "" }
      )
    }
  }, [open, template, reset])

  async function onSubmit(data: FormValues) {
    const payload: TemplateInput = {
      name:     data.name,
      category: data.category,
      subject:  data.subject,
      body:     data.body,
      smsBody:  data.smsBody?.trim() || undefined,
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

  const subject    = watch("subject")
  const bodyHtml   = watch("body")
  const smsBody    = watch("smsBody") ?? ""
  const isPending  = isSubmitting || createMut.isPending || updateMut.isPending

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

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("messages.templateModal.variablesHint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {variables.map(v => (
              <button
                key={v.token}
                type="button"
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("text/plain", v.token)
                  e.dataTransfer.effectAllowed = "copy"
                }}
                className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-mono cursor-grab active:cursor-grabbing select-none hover:bg-muted hover:border-foreground/20 transition-colors"
              >
                <DotsSixIcon className="size-2.5 text-muted-foreground" />
                {v.token}
                <span className="text-muted-foreground ml-0.5 font-sans normal-case">— {v.label}</span>
              </button>
            ))}
          </div>
        </div>

        <RichTextEditor
          label={t("messages.templateModal.emailBody")}
          required
          value={watch("body")}
          onChange={v => setValue("body", v, { shouldValidate: true })}
          placeholder={t("messages.templateModal.emailBodyPlaceholder")}
          minHeight="200px"
          error={errors.body?.message}
        />

        {sms && (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewOpen(true)}>
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
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">{t("messages.templateModal.previewSubject")}</p>
            <p className="text-sm font-medium">{substituteVars(subject || "", PREVIEW_VARS)}</p>
          </div>
          <div className="rounded-lg border p-4 bg-card">
            <RichTextView content={substituteVars(bodyHtml || "", PREVIEW_VARS)} />
          </div>
        </div>
      </Modal>
    </Modal>
  )
}
