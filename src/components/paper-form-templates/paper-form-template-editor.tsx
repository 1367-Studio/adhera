"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { PlusIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr"
import {
  useAnalyzePaperForm, useCreatePaperFormTemplate, useDeletePaperFormTemplate, useUpdatePaperFormTemplate,
  type PaperFormTemplate,
} from "@/hooks/use-paper-form-templates"
import { useAssociationDocuments } from "@/hooks/use-association-documents"
import { paperFormTemplateSchema, type PaperFormField, type PaperFormTemplateInput } from "@/lib/schemas"
import { PAPER_FORM_MAX_FIELDS, PAPER_FORM_MAX_PAGES, PAPER_FORM_FIELD_KEY_REGEX } from "@/lib/paper-form-targets"
import {
  renderFileToPageImages, releasePageImages, PageRenderError, PAGE_IMAGES_REQUEST_BUDGET_BYTES,
  PAGE_RENDER_ACCEPT_ATTRIBUTE, type RenderedPageImage,
} from "@/lib/paper-form/render-pages.client"
import { ApiError } from "@/lib/api-error"
import { BackLink } from "@/components/ui/back-link"
import { PageHeader } from "@/components/ui/page-header"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"
import { PAPER_FORM_TEMPLATES_PATH } from "./paper-form-templates-view"
import { BlankFormDropZone, PaperFormPageThumbnails } from "./paper-form-page-previews"
import { PaperFormFieldsTable, type EditablePaperFormField } from "./paper-form-fields-table"

const AI_SETTINGS_PATH = "/dashboard/parametres?tab=integrations"
// Every blank page goes to /analyze in ONE request, so each is held to its share of the body
// cap — computed for the largest form allowed, whatever the actual page count.
const BLANK_PAGE_BYTE_BUDGET = Math.floor(PAGE_IMAGES_REQUEST_BUDGET_BYTES / PAPER_FORM_MAX_PAGES)
const MAXIMUM_ERRORS_LISTED  = 6
const IDENTIFICATION_TEXT_MAX_LENGTH = 300

// The blank pages exist only in this tab (they are never uploaded). When /nouveau saves and
// navigates to /[id], the edit screen picks them up from here so the previews survive.
const blankFormPagesByTemplateId = new Map<string, RenderedPageImage[]>()

type EditorPhase = "upload" | "preparing" | "analyzing" | "analyzeFailed" | "editing"

type AnalyzeFailure = { message: string; needsAiSettings: boolean }

type EditorValues = {
  name:         string
  // Empty = the template accepts any page; otherwise pages that are not this form are refused.
  identificationText: string
  pagesPerForm: number
  fields:       EditablePaperFormField[]
}

function toEditableField(field: PaperFormField): EditablePaperFormField {
  return {
    key:             field.key,
    label:           field.label,
    page:            field.page,
    target:          field.target,
    legalDocumentId: field.legalDocumentId ?? "",
    hint:            field.hint ?? "",
  }
}

function toEditorValues(template?: PaperFormTemplate): EditorValues {
  return {
    name:         template?.name ?? "",
    identificationText: template?.identificationText ?? "",
    pagesPerForm: template?.pagesPerForm ?? 1,
    fields:       template?.fields.map(toEditableField) ?? [],
  }
}

function toTemplateInput(values: EditorValues): PaperFormTemplateInput {
  return {
    name:         values.name.trim(),
    // null (not omitted) so clearing the input on the edit screen really turns the check off.
    identificationText: values.identificationText.trim() || null,
    pagesPerForm: values.pagesPerForm,
    fields:       values.fields.map(field => ({
      key:    field.key,
      label:  field.label.trim(),
      page:   field.page,
      target: field.target,
      ...(field.target === "legalDocument" && field.legalDocumentId ? { legalDocumentId: field.legalDocumentId } : {}),
      ...(field.hint.trim() ? { hint: field.hint.trim() } : {}),
    })),
  }
}

function createUniqueFieldKey(existingFields: readonly EditablePaperFormField[]): string {
  const existingKeys = new Set(existingFields.map(field => field.key))
  let suffix = existingFields.length + 1
  while (existingKeys.has(`champ_${suffix}`)) suffix++
  const generatedKey = `champ_${suffix}`
  return PAPER_FORM_FIELD_KEY_REGEX.test(generatedKey) ? generatedKey : `champ_${Date.now()}`
}

function fileBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120)
}

// The analyze route answers a plain 422 message when the association has no vision-capable
// key of its own; a `code` is preferred when the route provides one.
function isMissingVisionKeyError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.code === "VISION_NOT_SUPPORTED" || /clé API|Paramètres → IA/.test(error.message)
}

interface PaperFormTemplateEditorProps {
  // Absent on /nouveau — the same editor then starts from the blank-form upload.
  template?: PaperFormTemplate
}

export function PaperFormTemplateEditor({ template }: PaperFormTemplateEditorProps) {
  const t             = useTranslations("paperFormTemplates")
  const tCommon       = useTranslations("common")
  const router        = useRouter()
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const isEditing     = !!template

  const [values, setValues]               = useState<EditorValues>(() => toEditorValues(template))
  const [savedValues, setSavedValues]     = useState<EditorValues>(() => toEditorValues(template))
  const [phase, setPhase]                 = useState<EditorPhase>(isEditing ? "editing" : "upload")
  const [pageImages, setPageImages]       = useState<RenderedPageImage[]>(() => {
    if (!template) return []
    const handedOffPages = blankFormPagesByTemplateId.get(template.id) ?? []
    blankFormPagesByTemplateId.delete(template.id)
    return handedOffPages
  })
  const [isPreparingReference, setIsPreparingReference] = useState(false)
  const [analyzeFailure, setAnalyzeFailure]             = useState<AnalyzeFailure | null>(null)
  const [droppedFieldCount, setDroppedFieldCount]       = useState(0)
  const [errorPaths, setErrorPaths]                     = useState<Set<string>>(() => new Set())
  const [errorMessages, setErrorMessages]               = useState<string[]>([])
  const [nameError, setNameError]                       = useState<string | undefined>()
  const [identificationError, setIdentificationError]   = useState<string | undefined>()

  const [leaveConfirmOpen, setLeaveConfirmOpen]   = useState(false)
  const [leaveSaving, setLeaveSaving]             = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  // Same guard as the association-document form: once the POST succeeded, the page only
  // waits for router.replace, and a second click must not create a duplicate.
  const createStatusRef           = useRef<"idle" | "pending" | "created">("idle")
  const [isCreated, setIsCreated] = useState(false)

  const analyzeMutation = useAnalyzePaperForm()
  const createMutation  = useCreatePaperFormTemplate()
  const updateMutation  = useUpdatePaperFormTemplate()
  const deleteMutation  = useDeletePaperFormTemplate()
  const isSaving        = createMutation.isPending || updateMutation.isPending

  const { data: associationDocuments = [] } = useAssociationDocuments()
  const legalDocumentOptions = associationDocuments.map(document => ({ id: document.id, title: document.title }))

  const hasUnsavedChanges = !isCreated && JSON.stringify(values) !== JSON.stringify(savedValues)

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [hasUnsavedChanges])

  // Object URLs of the previews are released on unmount — unless they were handed to the
  // edit screen. The check is deferred one tick so a Strict Mode remount keeps them alive.
  const pageImagesRef   = useRef(pageImages)
  const isMountedRef    = useRef(false)
  const handedOffRef    = useRef(false)
  useEffect(() => { pageImagesRef.current = pageImages }, [pageImages])
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      setTimeout(() => {
        if (!isMountedRef.current && !handedOffRef.current) releasePageImages(pageImagesRef.current)
      }, 0)
    }
  }, [])

  function replacePageImages(nextPageImages: RenderedPageImage[]) {
    releasePageImages(pageImagesRef.current)
    pageImagesRef.current = nextPageImages
    setPageImages(nextPageImages)
  }

  function describeRenderError(error: unknown): string {
    if (error instanceof PageRenderError) return t(`renderErrors.${error.code}`, { maximum: PAPER_FORM_MAX_PAGES })
    return tCommon("genericError")
  }

  // Renders every file in order; photos give one page each, a PDF gives all of its pages.
  async function renderBlankForm(files: File[]): Promise<RenderedPageImage[] | null> {
    const renderedPages: RenderedPageImage[] = []
    try {
      for (const file of files) {
        const filePages = await renderFileToPageImages(file, {
          maxPageBytes: BLANK_PAGE_BYTE_BUDGET,
          maxPages:     PAPER_FORM_MAX_PAGES,
        })
        renderedPages.push(...filePages)
        if (renderedPages.length > PAPER_FORM_MAX_PAGES) {
          throw new PageRenderError("too_many_pages", "")
        }
      }
      return renderedPages
    } catch (error) {
      releasePageImages(renderedPages)
      toast.error(describeRenderError(error))
      return null
    }
  }

  async function analyzePages(pagesToAnalyze: RenderedPageImage[]) {
    setPhase("analyzing")
    setAnalyzeFailure(null)
    try {
      const proposal = await analyzeMutation.mutateAsync({
        pages: pagesToAnalyze.map(page => ({ base64: page.base64, mediaType: page.mediaType })),
      })
      setValues(previousValues => ({
        ...previousValues,
        pagesPerForm: proposal.pagesPerForm,
        fields:       proposal.fields.map(toEditableField),
      }))
      setDroppedFieldCount(proposal.droppedFieldCount)
      setPhase("editing")
    } catch (error) {
      setAnalyzeFailure({
        message:         error instanceof Error ? error.message : tCommon("genericError"),
        needsAiSettings: isMissingVisionKeyError(error),
      })
      setPhase("analyzeFailed")
    }
  }

  async function handleBlankFormFiles(files: File[]) {
    setPhase("preparing")
    const renderedPages = await renderBlankForm(files)
    if (!renderedPages) { setPhase("upload"); return }

    replacePageImages(renderedPages)
    setValues(previousValues => ({
      ...previousValues,
      name:         previousValues.name || fileBaseName(files[0].name),
      pagesPerForm: renderedPages.length,
    }))
    await analyzePages(renderedPages)
  }

  // Edit screen only: shows the blank form beside the mapping, nothing is analysed or saved.
  async function handleReferenceFiles(files: File[]) {
    setIsPreparingReference(true)
    try {
      const renderedPages = await renderBlankForm(files)
      if (renderedPages) replacePageImages(renderedPages)
    } finally {
      setIsPreparingReference(false)
    }
  }

  function startManualMapping() {
    setValues(previousValues => ({
      ...previousValues,
      pagesPerForm: Math.max(1, Math.min(PAPER_FORM_MAX_PAGES, pageImages.length || previousValues.pagesPerForm)),
      fields:       previousValues.fields.length > 0 ? previousValues.fields : [{
        key: createUniqueFieldKey([]), label: "", page: 1, target: "fullName", legalDocumentId: "", hint: "",
      }],
    }))
    setAnalyzeFailure(null)
    setPhase("editing")
  }

  function restartUpload() {
    replacePageImages([])
    setAnalyzeFailure(null)
    setDroppedFieldCount(0)
    setPhase("upload")
  }

  function clearErrors() {
    if (errorPaths.size > 0) setErrorPaths(new Set())
    if (errorMessages.length > 0) setErrorMessages([])
    if (nameError) setNameError(undefined)
    if (identificationError) setIdentificationError(undefined)
  }

  function updateField(rowIndex: number, patch: Partial<EditablePaperFormField>) {
    setValues(previousValues => ({
      ...previousValues,
      fields: previousValues.fields.map((field, fieldIndex) => fieldIndex === rowIndex ? { ...field, ...patch } : field),
    }))
    clearErrors()
  }

  function removeField(rowIndex: number) {
    setValues(previousValues => ({
      ...previousValues,
      fields: previousValues.fields.filter((_field, fieldIndex) => fieldIndex !== rowIndex),
    }))
    clearErrors()
  }

  function addField() {
    setValues(previousValues => {
      const lastField = previousValues.fields.at(-1)
      return {
        ...previousValues,
        fields: [...previousValues.fields, {
          key:             createUniqueFieldKey(previousValues.fields),
          label:           "",
          page:            Math.min(lastField?.page ?? 1, previousValues.pagesPerForm),
          target:          "notes",
          legalDocumentId: "",
          hint:            "",
        }],
      }
    })
    clearErrors()
  }

  // Client-side run of the route's own schema, so problems point at their row before any
  // request is made. Returns the payload, or null with the errors displayed.
  function validateForSave(): PaperFormTemplateInput | null {
    const payload = toTemplateInput(values)
    const parsed  = paperFormTemplateSchema.safeParse(payload)
    if (parsed.success) { clearErrors(); return parsed.data }

    const nextErrorPaths    = new Set<string>()
    const nextErrorMessages = new Set<string>()
    let nextNameError: string | undefined
    let nextIdentificationError: string | undefined
    for (const issue of parsed.error.issues) {
      const [rootKey, rowIndex, property] = issue.path
      if (rootKey === "name") { nextNameError = issue.message; continue }
      if (rootKey === "identificationText") { nextIdentificationError = issue.message; continue }
      if (rootKey === "fields" && typeof rowIndex === "number") {
        nextErrorPaths.add(`${rowIndex}.${String(property ?? "label")}`)
        nextErrorMessages.add(t("editor.rowError", { row: rowIndex + 1, message: issue.message }))
        continue
      }
      nextErrorMessages.add(issue.message)
    }
    setErrorPaths(nextErrorPaths)
    setErrorMessages([...nextErrorMessages])
    setNameError(nextNameError)
    setIdentificationError(nextIdentificationError)
    return null
  }

  async function saveTemplate(): Promise<PaperFormTemplate | null> {
    const payload = validateForSave()
    if (!payload) return null

    if (!template) {
      if (createStatusRef.current !== "idle") return null
      createStatusRef.current = "pending"
      try {
        const createdTemplate = await createMutation.mutateAsync(payload)
        createStatusRef.current = "created"
        setIsCreated(true)
        toast.success(t("toasts.created"))
        return createdTemplate
      } catch (error) {
        createStatusRef.current = "idle"
        toast.error(error instanceof Error ? error.message : tCommon("genericError"))
        return null
      }
    }

    const submittedValues = values
    try {
      const updatedTemplate = await updateMutation.mutateAsync({ templateId: template.id, data: payload })
      toast.success(t("toasts.saved"))
      const storedValues = toEditorValues(updatedTemplate)
      setSavedValues(storedValues)
      // Only replace what the manager did not touch while the request was in flight.
      setValues(currentValues => currentValues === submittedValues ? storedValues : currentValues)
      return updatedTemplate
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("genericError"))
      return null
    }
  }

  async function handleSave() {
    const savedTemplate = await saveTemplate()
    if (savedTemplate && !template) {
      if (pageImagesRef.current.length > 0) {
        blankFormPagesByTemplateId.set(savedTemplate.id, pageImagesRef.current)
        handedOffRef.current = true
      }
      router.replace(`${PAPER_FORM_TEMPLATES_PATH}/${savedTemplate.id}`)
    }
  }

  async function handleSaveAndLeave() {
    setLeaveSaving(true)
    try {
      const savedTemplate = await saveTemplate()
      if (savedTemplate) router.push(PAPER_FORM_TEMPLATES_PATH)
      else setLeaveConfirmOpen(false)
    } finally {
      setLeaveSaving(false)
    }
  }

  async function handleDelete() {
    if (!template) return
    try {
      await deleteMutation.mutateAsync(template.id)
      toast.success(t("toasts.deleted"))
      setDeleteConfirmOpen(false)
      router.push(PAPER_FORM_TEMPLATES_PATH)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("genericError"))
    }
  }

  const pagesPerFormOptions = Array.from({ length: PAPER_FORM_MAX_PAGES }, (_unused, pageIndex) => ({
    value: String(pageIndex + 1),
    label: t("editor.pageCount", { count: pageIndex + 1 }),
  }))
  const mappedFieldCount = values.fields.filter(field => field.target !== "ignore").length
  const showsMapping     = phase === "editing"

  return (
    <div className="space-y-4">
      <BackLink
        href={PAPER_FORM_TEMPLATES_PATH}
        onClick={event => { if (hasUnsavedChanges) { event.preventDefault(); setLeaveConfirmOpen(true) } }}
      >
        {t("backToList")}
      </BackLink>

      <PageHeader
        title={template ? template.name : t("editor.newTitle")}
        description={template
          ? t("editor.updatedAt", { date: format(new Date(template.updatedAt), "d MMMM yyyy", { locale: dateFnsLocale }) })
          : t("editor.newDescription")}
        action={showsMapping && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              loading={isSaving || isCreated}
              disabled={isEditing && !hasUnsavedChanges}
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
        )}
      />

      {(phase === "upload" || phase === "preparing") && (
        <div className="max-w-2xl space-y-3">
          <BlankFormDropZone onFiles={handleBlankFormFiles} disabled={phase === "preparing"} />
          {phase === "preparing" ? (
            <p className="text-sm text-muted-foreground" role="status">{t("editor.preparing")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("editor.manualIntro")}{" "}
              <Button variant="link" className="h-auto p-0" onClick={startManualMapping}>
                {t("editor.configureManually")}
              </Button>
            </p>
          )}
        </div>
      )}

      {(phase === "analyzing" || phase === "analyzeFailed") && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <aside className="lg:w-48 lg:shrink-0">
            <PaperFormPageThumbnails pages={pageImages} />
          </aside>
          <div className="max-w-2xl flex-1 space-y-3">
            {phase === "analyzing" ? (
              <div className="space-y-1" role="status">
                <p className="text-sm font-medium">{t("editor.analyzing")}</p>
                <p className="text-sm text-muted-foreground">{t("editor.analyzingHint")}</p>
              </div>
            ) : (
              <>
                <div className="space-y-1" role="alert">
                  <p className="text-sm font-medium text-destructive">{t("editor.analyzeFailedTitle")}</p>
                  <p className="text-sm text-muted-foreground">{analyzeFailure?.message}</p>
                  {analyzeFailure?.needsAiSettings && (
                    <Link href={AI_SETTINGS_PATH} className="text-sm text-primary underline-offset-4 hover:underline">
                      {t("editor.openAiSettings")}
                    </Link>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => analyzePages(pageImages)}>{t("editor.retryAnalyze")}</Button>
                  <Button variant="outline" onClick={startManualMapping}>{t("editor.configureManually")}</Button>
                  <Button variant="ghost" onClick={restartUpload}>{t("editor.changeFile")}</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showsMapping && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <aside className="space-y-3 lg:w-48 lg:shrink-0">
            {pageImages.length > 0 ? (
              <PaperFormPageThumbnails pages={pageImages} />
            ) : (
              <ReferenceFormPicker onFiles={handleReferenceFiles} loading={isPreparingReference} />
            )}
          </aside>

          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="w-full max-w-md">
                <FormField
                  id="paper-form-template-name"
                  label={t("editor.nameLabel")}
                  required
                  placeholder={t("editor.namePlaceholder")}
                  value={values.name}
                  maxLength={120}
                  error={nameError}
                  onChange={event => { const name = event.target.value; setValues(previousValues => ({ ...previousValues, name })); clearErrors() }}
                />
              </div>
              <div className="w-40">
                <SelectField
                  id="paper-form-template-pages"
                  label={t("editor.pagesPerFormLabel")}
                  options={pagesPerFormOptions}
                  value={String(values.pagesPerForm)}
                  onValueChange={value => { setValues(previousValues => ({ ...previousValues, pagesPerForm: Number(value) })); clearErrors() }}
                />
              </div>
            </div>

            <div className="max-w-2xl">
              <FormField
                id="paper-form-template-identification"
                label={t("editor.identificationLabel")}
                placeholder={t("editor.identificationPlaceholder")}
                hint={t("editor.identificationHint")}
                value={values.identificationText}
                maxLength={IDENTIFICATION_TEXT_MAX_LENGTH}
                error={identificationError}
                onChange={event => {
                  const identificationText = event.target.value
                  setValues(previousValues => ({ ...previousValues, identificationText }))
                  clearErrors()
                }}
              />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-sm font-medium">{t("editor.fieldsTitle")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("editor.fieldsSummary", { count: values.fields.length, mapped: mappedFieldCount })}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{t("editor.fieldsHint")}</p>
              {droppedFieldCount > 0 && (
                <p className="text-xs text-muted-foreground">{t("editor.droppedFields", { count: droppedFieldCount })}</p>
              )}
            </div>

            {values.fields.length > 0 ? (
              <PaperFormFieldsTable
                fields={values.fields}
                pagesPerForm={values.pagesPerForm}
                legalDocuments={legalDocumentOptions}
                errorPaths={errorPaths}
                onFieldChange={updateField}
                onFieldRemove={removeField}
              />
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("editor.noFields")}</p>
            )}

            {errorMessages.length > 0 && (
              <ul className="space-y-0.5 text-xs text-destructive" role="alert">
                {errorMessages.slice(0, MAXIMUM_ERRORS_LISTED).map(message => <li key={message}>{message}</li>)}
                {errorMessages.length > MAXIMUM_ERRORS_LISTED && (
                  <li>{t("editor.moreErrors", { count: errorMessages.length - MAXIMUM_ERRORS_LISTED })}</li>
                )}
              </ul>
            )}

            <Button variant="ghost" onClick={addField} disabled={values.fields.length >= PAPER_FORM_MAX_FIELDS}>
              <PlusIcon className="size-4" />
              {t("editor.addField")}
            </Button>
          </div>
        </div>
      )}

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
            <Button variant="destructive" onClick={() => router.push(PAPER_FORM_TEMPLATES_PATH)} disabled={leaveSaving}>
              {t("leaveWarning.discard")}
            </Button>
            <Button onClick={handleSaveAndLeave} loading={leaveSaving}>
              {t("leaveWarning.saveAndLeave")}
            </Button>
          </>
        }
      />

      {template && (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title={t("deleteConfirm.title", { name: template.name })}
          description={t("deleteConfirm.description")}
          confirmLabel={tCommon("delete")}
          loading={deleteMutation.isPending}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}

// Edit screen without previews: the blank form was never stored, so the manager may load it
// again locally to compare the mapping with the printed page.
function ReferenceFormPicker({ onFiles, loading }: { onFiles: (files: File[]) => void; loading: boolean }) {
  const t = useTranslations("paperFormTemplates.editor")
  const fileInputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("referenceHint")}</p>
      <input
        ref={fileInputRef}
        type="file"
        accept={PAGE_RENDER_ACCEPT_ATTRIBUTE}
        multiple
        className="hidden"
        onChange={event => {
          const files = event.target.files ? Array.from(event.target.files) : []
          event.target.value = ""
          if (files.length > 0) onFiles(files)
        }}
      />
      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} loading={loading}>
        <UploadSimpleIcon className="size-3.5" />
        {t("showBlankForm")}
      </Button>
    </div>
  )
}
