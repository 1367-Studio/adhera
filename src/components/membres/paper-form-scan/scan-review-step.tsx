"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ScanFormEditor, type LegalDocumentOption } from "./scan-form-editor"
import { ScanPageViewer } from "./scan-page-viewer"
import {
  fullNameOf,
  hasMissingPage,
  type DraftErrors,
  type LowConfidenceKey,
  type ReviewDraft,
  type ScanForm,
  type ScanFormStatus,
  type ScanPage,
} from "./scan-model"

// Status → shared Badge variant, following the app-wide meanings: pending → warning,
// ready (active) → primary, done → success, error → destructive, set aside → neutral.
const STATUS_BADGE_VARIANT: Record<ScanFormStatus, "warning" | "default" | "success" | "destructive" | "secondary"> = {
  toReview:  "warning",
  validated: "default",
  created:   "success",
  error:     "destructive",
  ignored:   "secondary",
}

type ScanReviewStepProps = {
  forms:              ScanForm[]
  pagesById:          Map<string, ScanPage>
  currentFormId:      string
  onSelectForm:       (formId: string) => void
  legalDocuments:     LegalDocumentOption[]
  shownErrors:        DraftErrors
  isCheckingDuplicates: boolean
  isCommitting:       boolean
  onDraftChange:      (formId: string, patch: Partial<ReviewDraft>, editedKeys: LowConfidenceKey[]) => void
  onNameBlur:         (formId: string) => void
  onValidate:         (formId: string) => void
  onIgnore:           (formId: string) => void
  onReopen:           (formId: string) => void
  onCreate:           () => void
}

export function ScanReviewStep({
  forms, pagesById, currentFormId, onSelectForm, legalDocuments, shownErrors, isCheckingDuplicates, isCommitting,
  onDraftChange, onNameBlur, onValidate, onIgnore, onReopen, onCreate,
}: ScanReviewStepProps) {
  const t = useTranslations("paperFormScan.review")
  const tStatus = useTranslations("paperFormScan.status")

  const currentIndex = Math.max(0, forms.findIndex((form) => form.formId === currentFormId))
  const currentForm  = forms[currentIndex]
  const countByStatus = (status: ScanFormStatus) => forms.filter((form) => form.status === status).length
  const validatedCount = countByStatus("validated")
  const toReviewCount  = countByStatus("toReview") + countByStatus("error")

  if (!currentForm) return null

  const formLabel = (form: ScanForm, formIndex: number) =>
    fullNameOf(form.draft.firstName, form.draft.lastName) || t("untitledForm", { number: formIndex + 1 })
  const slotPages = currentForm.pageSlots.map((pageId) => (pageId ? pagesById.get(pageId) ?? null : null))
  const isCreated = currentForm.status === "created"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("summary", {
            total:     forms.length,
            toReview:  toReviewCount,
            validated: validatedCount,
            ignored:   countByStatus("ignored"),
            created:   countByStatus("created"),
          })}
          {isCheckingDuplicates && <> · {t("checkingDuplicates")}</>}
        </p>
        {/* Primary only once nothing is left to review, so it never competes with « Valider ». */}
        <Button
          variant={toReviewCount === 0 ? "default" : "outline"}
          onClick={onCreate}
          disabled={validatedCount === 0}
          loading={isCommitting}
        >
          {t("create", { count: validatedCount })}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* ─── Forms list ─── */}
        <nav aria-label={t("formsList")} className="lg:col-span-3 xl:col-span-2">
          <ul className="max-h-60 divide-y lg:max-h-[70vh] overflow-y-auto rounded-lg border text-sm">
            {forms.map((form, formIndex) => (
              <li key={form.formId}>
                <button
                  type="button"
                  onClick={() => onSelectForm(form.formId)}
                  aria-current={form.formId === currentForm.formId ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
                    form.formId === currentForm.formId && "bg-muted",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{formLabel(form, formIndex)}</span>
                    {hasMissingPage(form) && <span className="block text-xs text-destructive">{t("missingPage")}</span>}
                  </span>
                  <Badge variant={STATUS_BADGE_VARIANT[form.status]}>{tStatus(form.status)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* ─── Scanned pages ─── */}
        <div className="lg:col-span-4 xl:col-span-5">
          <ScanPageViewer key={currentForm.formId} slotPages={slotPages} />
        </div>

        {/* ─── Editable fields ─── */}
        <div className="space-y-6 lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{t("formPosition", { number: currentIndex + 1, total: forms.length })}</h2>
              <Badge variant={STATUS_BADGE_VARIANT[currentForm.status]}>{tStatus(currentForm.status)}</Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" aria-label={t("previous")} disabled={currentIndex === 0} onClick={() => onSelectForm(forms[currentIndex - 1].formId)}>
                <CaretLeftIcon />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={t("next")} disabled={currentIndex === forms.length - 1} onClick={() => onSelectForm(forms[currentIndex + 1].formId)}>
                <CaretRightIcon />
              </Button>
            </div>
          </div>

          {hasMissingPage(currentForm) && (
            <p className="text-sm text-destructive">{t("missingPageExplanation")}</p>
          )}
          {currentForm.status === "error" && currentForm.errorMessage && (
            <p className="text-sm text-destructive">{t("commitError", { error: currentForm.errorMessage })}</p>
          )}
          {isCreated && currentForm.membreId && (
            <p className="text-sm text-muted-foreground">
              {t("createdNotice")}{" "}
              <Link href={`/dashboard/membres/${currentForm.membreId}`} className="text-foreground underline-offset-4 hover:underline">
                {t("openMember")}
              </Link>
            </p>
          )}

          <ScanFormEditor
            key={currentForm.formId}
            form={currentForm}
            errors={shownErrors}
            legalDocuments={legalDocuments}
            readOnly={isCreated}
            onDraftChange={(patch, editedKeys) => onDraftChange(currentForm.formId, patch, editedKeys)}
            onNameBlur={() => onNameBlur(currentForm.formId)}
          />

          {!isCreated && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              {currentForm.status === "validated" || currentForm.status === "ignored" ? (
                <Button variant="ghost" onClick={() => onReopen(currentForm.formId)}>
                  {currentForm.status === "validated" ? t("unvalidate") : t("restore")}
                </Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => onIgnore(currentForm.formId)}>{t("ignore")}</Button>
                  <Button onClick={() => onValidate(currentForm.formId)}>{t("validate")}</Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
