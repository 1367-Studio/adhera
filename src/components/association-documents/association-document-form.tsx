"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import type { z } from "zod"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr"
import {
  useCreateAssociationDocument, useUpdateAssociationDocument, useDeleteAssociationDocument,
  type AssociationDocument,
} from "@/hooks/use-association-documents"
import { associationDocumentSchema, type AssociationDocumentInput } from "@/lib/schemas"
import { BackLink } from "@/components/ui/back-link"
import { PageHeader } from "@/components/ui/page-header"
import { FormField } from "@/components/ui/form-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

const ASSOCIATION_DOCUMENTS_PATH = "/dashboard/documents-association"
const FORM_ID                    = "document-form"
// What Tiptap emits for a document with nothing in it.
const EMPTY_EDITOR_HTML          = "<p></p>"

type AssociationDocumentFormValues = z.input<typeof associationDocumentSchema>

interface AssociationDocumentFormProps {
  // Absent on /nouveau — the same form then creates instead of updating.
  document?: AssociationDocument
}

function toFormValues(document?: AssociationDocument): AssociationDocumentFormValues {
  return {
    title:            document?.title ?? "",
    content:          document?.content ?? "",
    visibleToMembers: document?.visibleToMembers ?? false,
  }
}

export function AssociationDocumentForm({ document }: AssociationDocumentFormProps) {
  const t             = useTranslations("associationDocuments")
  const tCommon       = useTranslations("common")
  const router        = useRouter()
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const isEditing     = !!document

  const [leaveConfirmOpen, setLeaveConfirmOpen]   = useState(false)
  const [leaveSaving, setLeaveSaving]             = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  // On /nouveau, once the POST has succeeded the page is only waiting for router.replace:
  // the ref blocks a second create synchronously (click, Enter, "Enregistrer et quitter"),
  // the state keeps the save button busy and switches the leave guard off.
  const createStatusRef           = useRef<"idle" | "pending" | "created">("idle")
  const [isCreated, setIsCreated] = useState(false)

  const createMutation = useCreateAssociationDocument()
  const updateMutation = useUpdateAssociationDocument()
  const deleteMutation = useDeleteAssociationDocument()
  const isSaving       = createMutation.isPending || updateMutation.isPending

  const { register, control, handleSubmit, reset, getValues, setValue, formState: { errors, isDirty } } =
    useForm<AssociationDocumentFormValues, unknown, AssociationDocumentInput>({
      resolver:      zodResolver(associationDocumentSchema),
      defaultValues: toFormValues(document),
      mode:          "onSubmit",
    })

  const hasUnsavedChanges = isDirty && !isCreated

  // Covers tab close / reload / external links, which client-side routing never sees. The
  // browser shows its own generic wording — returnValue only has to be set.
  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [hasUnsavedChanges])

  // The schema's own messages are generic; the empty-field cases get the page's wording.
  const titleError = errors.title
    ? errors.title.type === "too_small" ? t("form.titleRequired") : errors.title.message
    : undefined
  const contentError = errors.content
    ? errors.content.type === "custom" ? t("form.contentRequired") : errors.content.message
    : undefined

  async function createDocument(values: AssociationDocumentInput): Promise<AssociationDocument | null> {
    if (createStatusRef.current !== "idle") return null
    createStatusRef.current = "pending"
    try {
      const createdDocument = await createMutation.mutateAsync(values)
      createStatusRef.current = "created"
      setIsCreated(true)
      toast.success(t("toasts.created"))
      return createdDocument
    } catch (error) {
      createStatusRef.current = "idle"
      toast.error(error instanceof Error ? error.message : tCommon("genericError"))
      return null
    }
  }

  async function updateDocument(existingDocument: AssociationDocument, values: AssociationDocumentInput): Promise<AssociationDocument | null> {
    // Raw values as submitted (before the schema trims the title), to tell once the request
    // is back which fields the manager kept editing while it was in flight.
    const submittedValues = getValues()
    try {
      const updatedDocument = await updateMutation.mutateAsync({ id: existingDocument.id, data: values })
      toast.success(t("toasts.saved"))
      const savedValues   = toFormValues(updatedDocument)
      const currentValues = getValues()
      // A field untouched since submit shows the stored version (the title comes back trimmed).
      if (currentValues.title === submittedValues.title && currentValues.title !== savedValues.title) {
        setValue("title", savedValues.title)
      }
      if (currentValues.content === submittedValues.content && currentValues.content !== savedValues.content) {
        setValue("content", savedValues.content)
      }
      // The saved values become the new baseline while keepValues leaves the fields as they
      // are, so the form only stays dirty if something was typed during the save.
      reset(savedValues, { keepValues: true })
      return updatedDocument
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("genericError"))
      return null
    }
  }

  // Returns the saved document, or null when it was not saved (errors are already toasted).
  function saveDocument(values: AssociationDocumentInput): Promise<AssociationDocument | null> {
    return document ? updateDocument(document, values) : createDocument(values)
  }

  async function handleFormSubmit(values: AssociationDocumentInput) {
    const savedDocument = await saveDocument(values)
    if (savedDocument && !document) router.replace(`${ASSOCIATION_DOCUMENTS_PATH}/${savedDocument.id}`)
  }

  async function handleSaveAndLeave() {
    setLeaveSaving(true)
    try {
      await handleSubmit(
        async values => {
          const savedDocument = await saveDocument(values)
          if (savedDocument) router.push(ASSOCIATION_DOCUMENTS_PATH)
        },
        // Invalid form: close the dialog so the inline errors are visible.
        () => setLeaveConfirmOpen(false),
      )()
    } finally {
      setLeaveSaving(false)
    }
  }

  async function handleDelete() {
    if (!document) return
    try {
      await deleteMutation.mutateAsync(document.id)
      toast.success(t("toasts.deleted"))
      setDeleteConfirmOpen(false)
      router.push(ASSOCIATION_DOCUMENTS_PATH)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("genericError"))
    }
  }

  return (
    <div className="space-y-4">
      <BackLink
        href={ASSOCIATION_DOCUMENTS_PATH}
        onClick={event => { if (hasUnsavedChanges) { event.preventDefault(); setLeaveConfirmOpen(true) } }}
      >
        {t("backToList")}
      </BackLink>

      <PageHeader
        title={document ? document.title : t("form.newTitle")}
        description={document
          ? t("form.updatedAt", { date: format(new Date(document.updatedAt), "d MMMM yyyy", { locale: dateFnsLocale }) })
          : t("form.newDescription")}
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              type="submit"
              form={FORM_ID}
              loading={isSaving || isCreated}
              disabled={isEditing && !isDirty}
            >
              {tCommon("save")}
            </Button>
            {isEditing && (
              <Button size="sm" variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
                <TrashIcon className="mr-1.5 size-4" />
                {tCommon("delete")}
              </Button>
            )}
          </div>
        }
      />

      {/* handleSubmit is built inside the handler: handleFormSubmit reads createStatusRef, which
          must not be passed along during render. */}
      <form id={FORM_ID} onSubmit={event => handleSubmit(handleFormSubmit)(event)} className="max-w-3xl space-y-5" noValidate>
        <FormField
          label={t("form.titleLabel")}
          required
          placeholder={t("form.titlePlaceholder")}
          error={titleError}
          {...register("title")}
        />

        <div className="flex items-start gap-3">
          <Controller
            name="visibleToMembers"
            control={control}
            render={({ field }) => (
              <Switch
                id="document-visible"
                className="mt-0.5"
                aria-describedby="document-visible-hint"
                checked={field.value ?? false}
                onCheckedChange={checked => field.onChange(checked)}
              />
            )}
          />
          <div className="space-y-0.5">
            <Label htmlFor="document-visible">{t("visibleToMembers")}</Label>
            <p id="document-visible-hint" className="text-xs text-muted-foreground">{t("visibleToMembersHint")}</p>
          </div>
        </div>

        <Controller
          name="content"
          control={control}
          render={({ field }) => (
            <RichTextEditor
              variant="document"
              label={t("form.contentLabel")}
              required
              value={field.value ?? ""}
              // An emptied editor reports "<p></p>"; storing it as "" keeps a create form
              // that was typed in and then cleared from counting as modified.
              onChange={html => field.onChange(html === EMPTY_EDITOR_HTML ? "" : html)}
              placeholder={t("form.contentPlaceholder")}
              minHeight="480px"
              error={contentError}
            />
          )}
        />
      </form>

      <Modal
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        title={t("leaveWarning.title")}
        description={t("leaveWarning.description")}
        size="md"
        dismissable={!leaveSaving}
        footer={
          <>
            <Button variant="outline" onClick={() => setLeaveConfirmOpen(false)} disabled={leaveSaving}>
              {tCommon("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => router.push(ASSOCIATION_DOCUMENTS_PATH)} disabled={leaveSaving}>
              {t("leaveWarning.discard")}
            </Button>
            <Button onClick={handleSaveAndLeave} loading={leaveSaving}>
              {t("leaveWarning.saveAndLeave")}
            </Button>
          </>
        }
      />

      {document && (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title={t("deleteConfirm.title", { title: document.title })}
          description={t("deleteConfirm.description")}
          confirmLabel={tCommon("delete")}
          loading={deleteMutation.isPending}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}
