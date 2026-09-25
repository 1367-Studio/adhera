"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { CaretRightIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { BackLink } from "@/components/ui/back-link"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PageHeader } from "@/components/ui/page-header"
import { useAssociationDocuments } from "@/hooks/use-association-documents"
import { usePaperFormTemplates } from "@/hooks/use-paper-form-templates"
import { PageRenderError, releasePageImages, renderFileToPageImages } from "@/lib/paper-form/render-pages.client"
import { PAPER_FORM_COMMIT_MAX_FORMS, type PaperFormDuplicatePerson, type PaperFormDuplicatesResponse } from "@/lib/schemas/paper-form"
import { cn } from "@/lib/utils"
import { checkDuplicates, commitForms, useInvalidateMembres } from "./scan-api"
import type { LegalDocumentOption } from "./scan-form-editor"
import {
  buildForms,
  fullNameOf,
  hasErrors,
  toCommitForm,
  validateForm,
  type DraftBuildLabels,
  type DuplicateCheck,
  type LowConfidenceKey,
  type ReviewDraft,
  type ScanForm,
  type ScanPage,
  type ValidationMessages,
} from "./scan-model"
import { ScanReadingStep } from "./scan-reading-step"
import { ScanResultStep, type CommitResultRow } from "./scan-result-step"
import { ScanReviewStep } from "./scan-review-step"
import { ScanUploadStep, type UploadedScanFile } from "./scan-upload-step"
import { usePageReader, type PageReadUpdate } from "./use-page-reader"

type WizardStep = "upload" | "reading" | "review" | "result"

const WIZARD_STEPS: WizardStep[] = ["upload", "reading", "review", "result"]
const MEMBRES_PATH = "/dashboard/membres"
// POST /api/membres/scan/duplicates accepts at most this many people per call.
const DUPLICATE_CHECK_BATCH_SIZE = 200

export function PaperFormScanWizard() {
  const t      = useTranslations("paperFormScan")
  const router = useRouter()
  const { data: templates = [], isLoading: templatesLoading, error: templatesError } = usePaperFormTemplates()
  const { data: associationDocuments = [] } = useAssociationDocuments()
  const invalidateMembres = useInvalidateMembres()

  const [step, setStep]                     = useState<WizardStep>("upload")
  const [chosenTemplateId, setChosenTemplateId] = useState("")
  const [files, setFiles]                   = useState<UploadedScanFile[]>([])
  const [preparingFileName, setPreparingFileName] = useState<string | null>(null)
  const [pages, setPages]                   = useState<ScanPage[]>([])
  const [forms, setForms]                   = useState<ScanForm[]>([])
  const [currentFormId, setCurrentFormId]   = useState("")
  // Errors are shown only once the manager has tried to validate that form.
  const [attemptedFormIds, setAttemptedFormIds] = useState<Set<string>>(new Set())
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false)
  const [isCommitting, setIsCommitting]     = useState(false)
  const [resultRows, setResultRows]         = useState<CommitResultRow[]>([])
  const [batchError, setBatchError]         = useState<string | null>(null)
  const [leaveConfirmOpen, setLeaveConfirmOpen]     = useState(false)
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false)

  const pageCounterRef   = useRef(0)
  const fileCounterRef   = useRef(0)
  const renderChainRef   = useRef<Promise<void>>(Promise.resolve())
  const renderControllerRef = useRef<AbortController | null>(null)
  // Every preview object URL ever created, so leaving the page frees them all.
  const previewUrlsRef   = useRef(new Set<string>())

  // A single template needs no choosing.
  const templateId = chosenTemplateId || (templates.length === 1 ? templates[0].id : "")
  const template   = templates.find((candidate) => candidate.id === templateId) ?? null

  // ─── Page reading ──────────────────────────────────────────────────────────────────────

  const handlePageUpdate = useCallback((pageId: string, update: PageReadUpdate) => {
    setPages((currentPages) => currentPages.map((page) => page.pageId === pageId
      ? { ...page, status: update.status, error: update.error, result: update.result ?? page.result, detectedTitle: update.detectedTitle ?? null }
      : page))
  }, [])

  const reader = usePageReader({ onPageUpdate: handlePageUpdate, fallbackMessage: t("reading.pageFailed") })

  // Created here rather than in useRef's initial value: StrictMode's mount → unmount → mount
  // in development would otherwise leave the page with an already-aborted controller.
  useEffect(() => {
    const previewUrls      = previewUrlsRef.current
    const renderController = new AbortController()
    renderControllerRef.current = renderController
    return () => {
      renderController.abort()
      for (const previewUrl of previewUrls) URL.revokeObjectURL(previewUrl)
      previewUrls.clear()
    }
  }, [])

  // ─── Unsaved work guard ────────────────────────────────────────────────────────────────

  const hasUnsavedWork =
    (step === "upload" && files.length > 0) ||
    step === "reading" ||
    forms.some((form) => form.status === "toReview" || form.status === "validated" || form.status === "error")

  // Tab close / reload / external link — client-side routing never sees these.
  useEffect(() => {
    if (!hasUnsavedWork) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [hasUnsavedWork])

  // ─── Upload ────────────────────────────────────────────────────────────────────────────

  async function renderFiles(selectedFiles: File[]) {
    // Phone photos are named in shooting order (IMG_0001…): a numeric-aware name sort keeps
    // the pages of one person together whatever order the picker handed them over in.
    const sortedFiles = [...selectedFiles].sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true }))
    for (const file of sortedFiles) {
      setPreparingFileName(file.name)
      try {
        const renderedPages = await renderFileToPageImages(file, { signal: renderControllerRef.current?.signal })
        fileCounterRef.current += 1
        const fileId = `file-${fileCounterRef.current}`
        const newPages: ScanPage[] = renderedPages.map((renderedPage) => {
          pageCounterRef.current += 1
          previewUrlsRef.current.add(renderedPage.previewUrl)
          return {
            pageId:       `page-${pageCounterRef.current}`,
            uploadIndex:  pageCounterRef.current - 1,
            sourceFileId: fileId,
            sourceName:   file.name,
            previewUrl:   renderedPage.previewUrl,
            width:        renderedPage.width,
            height:       renderedPage.height,
            status:       "pending",
            error:        null,
            result:       null,
            detectedTitle: null,
          }
        })
        reader.addPayloads(newPages.map((page, pageIndex) => [page.pageId, { base64: renderedPages[pageIndex].base64, mediaType: renderedPages[pageIndex].mediaType }]))
        setPages((currentPages) => [...currentPages, ...newPages])
        setFiles((currentFiles) => [...currentFiles, { fileId, name: file.name, pageCount: newPages.length }])
      } catch (error) {
        if (error instanceof PageRenderError && error.code === "aborted") return
        toast.error(t("upload.renderFailed", { name: file.name, error: error instanceof Error ? error.message : "" }))
      }
    }
    setPreparingFileName(null)
  }

  function handleAddFiles(selectedFiles: File[]) {
    // Chained so two drops in a row render one after the other, in drop order.
    renderChainRef.current = renderChainRef.current.then(() => renderFiles(selectedFiles))
  }

  function releasePages(pagesToRelease: ScanPage[]) {
    releasePageImages(pagesToRelease)
    for (const page of pagesToRelease) previewUrlsRef.current.delete(page.previewUrl)
    reader.removePayloads(pagesToRelease.map((page) => page.pageId))
  }

  function handleRemoveFile(fileId: string) {
    releasePages(pages.filter((page) => page.sourceFileId === fileId))
    setPages((currentPages) => currentPages.filter((page) => page.sourceFileId !== fileId))
    setFiles((currentFiles) => currentFiles.filter((file) => file.fileId !== fileId))
  }

  // Reading step: drops a page a strict template refused. Its file keeps the other pages.
  function handleRemovePage(pageId: string) {
    const removedPage = pages.find((page) => page.pageId === pageId)
    if (!removedPage) return
    releasePages([removedPage])
    setPages((currentPages) => currentPages.filter((page) => page.pageId !== pageId))
    setFiles((currentFiles) => currentFiles
      .map((file) => file.fileId === removedPage.sourceFileId ? { ...file, pageCount: file.pageCount - 1 } : file)
      .filter((file) => file.pageCount > 0))
  }

  function handleStartReading() {
    if (!template) return
    setStep("reading")
    reader.enqueue(template.id, [...pages].sort((first, second) => first.uploadIndex - second.uploadIndex).map((page) => page.pageId))
  }

  function restart() {
    reader.reset()
    releasePages(pages)
    setPages([]); setFiles([]); setForms([]); setCurrentFormId("")
    setAttemptedFormIds(new Set()); setResultRows([]); setBatchError(null)
    setStep("upload")
    setRestartConfirmOpen(false)
  }

  // ─── Reading → review ──────────────────────────────────────────────────────────────────

  function retryPages(pageIds: string[]) {
    if (!template || pageIds.length === 0) return
    setPages((currentPages) => currentPages.map((page) => pageIds.includes(page.pageId) ? { ...page, status: "pending", error: null } : page))
    reader.enqueue(template.id, pageIds)
  }

  const draftLabels: DraftBuildLabels = {
    booleans: { yes: t("notesValues.yes"), no: t("notesValues.no") },
  }

  const validationMessages: ValidationMessages = {
    firstNameRequired: t("validation.firstNameRequired"),
    lastNameRequired:  t("validation.lastNameRequired"),
    missingPage:       t("validation.missingPage"),
  }

  // Only the student is checked: legal guardians are stored on the student's record.
  function applyDuplicateMatches(checkedForms: ScanForm[], matches: PaperFormDuplicatesResponse["matches"]) {
    const checkedById = new Map(checkedForms.map((form) => [form.formId, form]))
    setForms((currentForms) => currentForms.map((form) => {
      const checkedForm = checkedById.get(form.formId)
      if (!checkedForm || !checkedForm.draft.firstName.trim() || !checkedForm.draft.lastName.trim()) return form
      const studentDuplicates: DuplicateCheck = {
        checkedName: fullNameOf(checkedForm.draft.firstName, checkedForm.draft.lastName),
        matches:     matches[form.formId] ?? [],
      }
      return { ...form, studentDuplicates }
    }))
  }

  function duplicatePeopleOf(form: ScanForm): PaperFormDuplicatePerson[] {
    const { draft } = form
    if (!draft.firstName.trim() || !draft.lastName.trim()) return []
    return [{ ref: form.formId, firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), email: draft.email.trim() || null, phone: draft.phone.trim() || null }]
  }

  async function runDuplicateCheck(formsToCheck: ScanForm[]) {
    const people = formsToCheck.flatMap(duplicatePeopleOf)
    if (people.length === 0) return
    setIsCheckingDuplicates(true)
    try {
      for (let batchStart = 0; batchStart < people.length; batchStart += DUPLICATE_CHECK_BATCH_SIZE) {
        const matches = await checkDuplicates(people.slice(batchStart, batchStart + DUPLICATE_CHECK_BATCH_SIZE))
        applyDuplicateMatches(formsToCheck, matches)
      }
    } catch {
      // Informational only: a failed check must not block the review.
      toast.error(t("review.duplicatesFailed"))
    } finally {
      setIsCheckingDuplicates(false)
    }
  }

  function goToReview() {
    if (!template) return
    const builtForms = buildForms(pages, template, draftLabels)
    setForms(builtForms)
    setCurrentFormId(builtForms[0]?.formId ?? "")
    setAttemptedFormIds(new Set())
    setStep("review")
    void runDuplicateCheck(builtForms)
  }

  // ─── Review ────────────────────────────────────────────────────────────────────────────

  function updateForm(formId: string, update: (form: ScanForm) => ScanForm) {
    setForms((currentForms) => currentForms.map((form) => form.formId === formId ? update(form) : form))
  }

  function handleDraftChange(formId: string, patch: Partial<ReviewDraft>, editedKeys: LowConfidenceKey[]) {
    updateForm(formId, (form) => ({
      ...form,
      draft:         { ...form.draft, ...patch },
      // A value the manager typed or confirmed is no longer "uncertain".
      lowConfidence: form.lowConfidence.filter((key) => !editedKeys.includes(key)),
    }))
  }

  function handleNameBlur(formId: string) {
    const form = forms.find((candidate) => candidate.formId === formId)
    if (!form) return
    if (form.studentDuplicates?.checkedName === fullNameOf(form.draft.firstName, form.draft.lastName)) return
    void runDuplicateCheck([form])
  }

  // Next form still needing attention after the given one, wrapping around.
  function nextFormToReview(afterFormId: string, formsSnapshot: ScanForm[]): string | null {
    const startIndex = formsSnapshot.findIndex((form) => form.formId === afterFormId)
    for (let offset = 1; offset <= formsSnapshot.length; offset++) {
      const candidate = formsSnapshot[(startIndex + offset) % formsSnapshot.length]
      if (candidate.formId !== afterFormId && (candidate.status === "toReview" || candidate.status === "error")) return candidate.formId
    }
    return null
  }

  function handleValidate(formId: string) {
    const form = forms.find((candidate) => candidate.formId === formId)
    if (!form) return
    if (hasErrors(validateForm(form, validationMessages))) {
      setAttemptedFormIds((currentIds) => new Set(currentIds).add(formId))
      return
    }
    const nextForms = forms.map((candidate) => candidate.formId === formId ? { ...candidate, status: "validated" as const, errorMessage: null } : candidate)
    setForms(nextForms)
    const nextFormId = nextFormToReview(formId, nextForms)
    if (nextFormId) setCurrentFormId(nextFormId)
  }

  function handleIgnore(formId: string) {
    const nextForms = forms.map((candidate) => candidate.formId === formId ? { ...candidate, status: "ignored" as const } : candidate)
    setForms(nextForms)
    const nextFormId = nextFormToReview(formId, nextForms)
    if (nextFormId) setCurrentFormId(nextFormId)
  }

  function handleReopen(formId: string) {
    updateForm(formId, (form) => ({ ...form, status: "toReview" }))
  }

  // ─── Create ────────────────────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!template) return
    const validatedForms = forms.filter((form) => form.status === "validated")
    // A validated form may have been edited since: re-check before sending, since one
    // invalid value would make the server refuse the whole batch.
    const invalidForms = validatedForms.filter((form) => hasErrors(validateForm(form, validationMessages)))
    if (invalidForms.length > 0) {
      const invalidIds = new Set(invalidForms.map((form) => form.formId))
      setForms((currentForms) => currentForms.map((form) => invalidIds.has(form.formId) ? { ...form, status: "toReview" } : form))
      setAttemptedFormIds((currentIds) => new Set([...currentIds, ...invalidIds]))
      setCurrentFormId(invalidForms[0].formId)
      toast.error(t("review.invalidBeforeCreate", { count: invalidForms.length }))
      return
    }

    setIsCommitting(true)
    const committedRows: CommitResultRow[] = []
    let stopMessage: string | null = null
    for (let batchStart = 0; batchStart < validatedForms.length; batchStart += PAPER_FORM_COMMIT_MAX_FORMS) {
      const batchForms = validatedForms.slice(batchStart, batchStart + PAPER_FORM_COMMIT_MAX_FORMS)
      try {
        const results = await commitForms(template.id, batchForms.map(toCommitForm))
        const resultsByRef = new Map(results.map((result) => [result.ref, result]))
        for (const form of batchForms) {
          const result = resultsByRef.get(form.formId)
          if (result) committedRows.push({ formId: form.formId, name: fullNameOf(form.draft.firstName, form.draft.lastName), result })
        }
        setForms((currentForms) => currentForms.map((form) => {
          const result = resultsByRef.get(form.formId)
          if (!result) return form
          return result.status === "created"
            ? { ...form, status: "created", membreId: result.membreId, errorMessage: null, skippedLegalDocumentIds: result.skippedLegalDocumentIds }
            : { ...form, status: "error", errorMessage: result.error }
        }))
      } catch (error) {
        // Refusal of the whole request (plan limit…): what was not sent stays validated.
        stopMessage = error instanceof Error ? error.message : t("result.genericError")
        break
      }
    }
    setIsCommitting(false)

    if (committedRows.some((row) => row.result.status === "created")) await invalidateMembres()
    if (committedRows.length === 0) {
      toast.error(stopMessage ?? t("result.genericError"))
      return
    }
    setResultRows(committedRows)
    setBatchError(stopMessage)
    setStep("result")
  }

  function handleBackToReview() {
    const firstOpenForm = forms.find((form) => form.status === "error" || form.status === "toReview" || form.status === "validated")
    if (firstOpenForm) setCurrentFormId(firstOpenForm.formId)
    setStep("review")
  }

  // ─── Derived view data ─────────────────────────────────────────────────────────────────

  const pagesById = useMemo(() => new Map(pages.map((page) => [page.pageId, page])), [pages])

  const legalDocumentTitles = useMemo(
    () => new Map(associationDocuments.map((associationDocument) => [associationDocument.id, associationDocument.title])),
    [associationDocuments],
  )

  // One entry per document, in template order, however many boxes point at it.
  const legalDocuments: LegalDocumentOption[] = []
  for (const field of template?.fields ?? []) {
    if (field.target !== "legalDocument" || !field.legalDocumentId) continue
    if (legalDocuments.some((option) => option.id === field.legalDocumentId)) continue
    legalDocuments.push({ id: field.legalDocumentId, title: legalDocumentTitles.get(field.legalDocumentId) ?? field.label })
  }

  const currentForm = forms.find((form) => form.formId === currentFormId) ?? null
  const shownErrors = currentForm && attemptedFormIds.has(currentForm.formId) ? validateForm(currentForm, validationMessages) : {}
  const remainingCount = forms.filter((form) => form.status === "toReview" || form.status === "validated" || form.status === "error").length
  const currentStepIndex = WIZARD_STEPS.indexOf(step)

  return (
    <div className="space-y-4">
      <BackLink
        href={MEMBRES_PATH}
        onClick={(event) => { if (hasUnsavedWork) { event.preventDefault(); setLeaveConfirmOpen(true) } }}
      >
        {t("backToMembers")}
      </BackLink>

      <PageHeader title={t("title")} description={t("description")} />

      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {WIZARD_STEPS.map((wizardStep, stepIndex) => (
          <li key={wizardStep} className="flex items-center gap-1">
            {stepIndex > 0 && <CaretRightIcon className="size-4 text-muted-foreground" />}
            <span
              aria-current={stepIndex === currentStepIndex ? "step" : undefined}
              className={cn(
                "font-medium",
                stepIndex === currentStepIndex ? "text-foreground" : stepIndex < currentStepIndex ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
              )}
            >
              {stepIndex < currentStepIndex ? <CheckCircleIcon className="inline size-4" /> : `${stepIndex + 1}.`} {t(`steps.${wizardStep}`)}
            </span>
          </li>
        ))}
      </ol>

      {templatesLoading ? (
        <p className="text-sm text-muted-foreground">{t("loadingTemplates")}</p>
      ) : templatesError ? (
        <p className="text-sm text-destructive">{templatesError.message}</p>
      ) : (
        <>
          {step === "upload" && (
            <ScanUploadStep
              templates={templates}
              templateId={templateId}
              onTemplateChange={setChosenTemplateId}
              files={files}
              preparingFileName={preparingFileName}
              onAddFiles={handleAddFiles}
              onRemoveFile={handleRemoveFile}
              onStart={handleStartReading}
            />
          )}

          {step === "reading" && (
            <ScanReadingStep
              pages={pages}
              isRunning={reader.isRunning}
              stop={reader.stop}
              onRetryPage={(pageId) => retryPages([pageId])}
              onRemovePage={handleRemovePage}
              onRetryAll={() => retryPages(pages.filter((page) => page.status === "error").map((page) => page.pageId))}
              onResume={reader.resume}
              onContinue={goToReview}
              onRestart={() => setRestartConfirmOpen(true)}
            />
          )}

          {step === "review" && (
            <ScanReviewStep
              forms={forms}
              pagesById={pagesById}
              currentFormId={currentFormId}
              onSelectForm={setCurrentFormId}
              legalDocuments={legalDocuments}
              shownErrors={shownErrors}
              isCheckingDuplicates={isCheckingDuplicates}
              isCommitting={isCommitting}
              onDraftChange={handleDraftChange}
              onNameBlur={handleNameBlur}
              onValidate={handleValidate}
              onIgnore={handleIgnore}
              onReopen={handleReopen}
              onCreate={handleCreate}
            />
          )}

          {step === "result" && (
            <ScanResultStep
              rows={resultRows}
              batchError={batchError}
              legalDocumentTitles={legalDocumentTitles}
              remainingCount={remainingCount}
              onBackToReview={handleBackToReview}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        title={t("leaveWarning.title")}
        description={t("leaveWarning.description")}
        confirmLabel={t("leaveWarning.confirm")}
        onConfirm={() => { setLeaveConfirmOpen(false); router.push(MEMBRES_PATH) }}
      />
      <ConfirmDialog
        open={restartConfirmOpen}
        onOpenChange={setRestartConfirmOpen}
        title={t("restartWarning.title")}
        description={t("restartWarning.description")}
        confirmLabel={t("restartWarning.confirm")}
        onConfirm={restart}
      />
    </div>
  )
}
