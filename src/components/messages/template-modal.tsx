"use client"

import { useEffect, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { DotsSixIcon, ChatTextIcon, PaperPlaneTiltIcon, EyeIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { RichTextView } from "@/components/ui/rich-text-view"
import { useModules } from "@/lib/user-context"
import { substituteVars, buildVars, TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_LABELS } from "@/lib/automation"
import {
  useCreateTemplate, useUpdateTemplate, useTestSendTemplate,
  type MessageTemplate, type TemplateInput,
} from "@/hooks/use-message-templates"

function hasText(html: string) {
  return html.replace(/<[^>]*>/g, "").trim().length > 0
}

const CATEGORY_OPTIONS = TEMPLATE_CATEGORIES.map(value => ({ value, label: TEMPLATE_CATEGORY_LABELS[value] }))

const schema = z.object({
  name:     z.string().min(1, "Requis"),
  category: z.enum(TEMPLATE_CATEGORIES),
  subject:  z.string().min(1, "Requis"),
  body:     z.string().refine(hasText, "Requis"),
  smsBody:  z.string().optional(),
})

type FormValues = z.infer<typeof schema>

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

const VARIABLES = [
  { token: "{{prenom}}",             label: "Prénom" },
  { token: "{{nom}}",                label: "Nom" },
  { token: "{{nom_complet}}",        label: "Nom complet" },
  { token: "{{email}}",              label: "Email" },
  { token: "{{association}}",        label: "Association" },
  { token: "{{lien_portal}}",        label: "Lien portail" },
  { token: "{{annee_cotisation}}",   label: "Année cotis." },
  { token: "{{montant_cotisation}}", label: "Montant cotis." },
  { token: "{{titre_evenement}}",    label: "Titre événement" },
  { token: "{{date_evenement}}",     label: "Date événement" },
  { token: "{{lieu_evenement}}",     label: "Lieu événement" },
]

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  template?:    MessageTemplate | null
}

export function TemplateModal({ open, onOpenChange, template }: Props) {
  const isEditing = !!template
  const { sms }   = useModules()
  const createMut = useCreateTemplate()
  const updateMut = useUpdateTemplate(template?.id ?? "")
  const testMut   = useTestSendTemplate()
  const [previewOpen, setPreviewOpen] = useState(false)

  const { register, handleSubmit, reset, setValue, watch, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver:      zodResolver(schema),
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
        toast.success("Modèle mis à jour")
      } else {
        await createMut.mutateAsync(payload)
        toast.success("Modèle créé")
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleTestSend() {
    try {
      const res = await testMut.mutateAsync(template!.id) as { sentTo: string }
      toast.success(`Email de test envoyé à ${res.sentTo}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
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
      title={isEditing ? "Modifier le modèle" : "Nouveau modèle"}
      size="2xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Nom interne"
            required
            placeholder="Rappel cotisation annuelle"
            error={errors.name?.message}
            {...register("name")}
          />
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Catégorie"
                options={CATEGORY_OPTIONS}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        </div>
        <FormField
          label="Objet de l'email"
          required
          placeholder="Rappel : votre cotisation {{annee_cotisation}}"
          error={errors.subject?.message}
          {...register("subject")}
        />

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Variables — glissez dans l'objet, le corps ou le SMS</p>
          <div className="flex flex-wrap gap-1.5">
            {VARIABLES.map(v => (
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
          label="Corps du message (email)"
          required
          value={watch("body")}
          onChange={v => setValue("body", v, { shouldValidate: true })}
          placeholder="Bonjour {{prenom}},…"
          minHeight="200px"
          error={errors.body?.message}
        />

        {sms && (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <ChatTextIcon className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">Corps du SMS</p>
            </div>
            <p className="text-xs text-muted-foreground">Texte court envoyé par SMS. Laissez vide si ce modèle n'est pas utilisé avec un canal SMS.</p>
            <textarea
              {...register("smsBody")}
              rows={3}
              placeholder="{{association}} — Bonjour {{prenom}}, …"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className={`text-xs text-right ${smsBody.length > 160 ? "text-amber-600" : "text-muted-foreground"}`}>
              {smsBody.length} / 160 caractères{smsBody.length > 160 ? " — sera divisé en plusieurs SMS" : ""}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewOpen(true)}>
              <EyeIcon className="mr-1.5 size-3.5" /> Aperçu
            </Button>
            {isEditing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={testMut.isPending}
                title="Envoie un email de test à votre adresse"
                onClick={handleTestSend}
              >
                <PaperPlaneTiltIcon className="mr-1.5 size-3.5" /> Tester
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Annuler
            </Button>
            <Button type="submit" loading={isPending}>
              {isEditing ? "Enregistrer" : "Créer"}
            </Button>
          </div>
        </div>
      </form>

      <Modal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Aperçu du message"
        description="Rendu avec des données d'exemple"
        size="lg"
      >
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Objet</p>
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
