"use client"

import { useTranslations } from "next-intl"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { DocumentUpload } from "@/components/ui/document-upload"
import { Label } from "@/components/ui/label"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { isTermsConfigurationValid, type FormTermsAttachment } from "@/lib/form-terms"

// The namespaces of the three editors that carry form-specific terms. Each one holds the
// same four keys (conditionsLabel, conditionsPlaceholder, conditionsPdfLabel, requireCguvLabel).
export type FormTermsTranslationNamespace =
  | "donationForms.detail.steps.info"
  | "membershipForms.detail.steps.info"
  | "evenements.form"

export type PendingTermsDocument = { blobUrl: string; file: File }

// Put on the "require acceptance" checkbox so a refused save / publish can bring it into view.
const REQUIRE_ACCEPTANCE_INPUT_ID = "form-terms-require-acceptance"

// "Vous devez remplir le champ « Conditions générales » ou importer un document." — built
// from the editor's own conditions label so the message always names the field on screen.
// Also used by the editors to translate the save/publish routes' TERMS_CONTENT_REQUIRED.
export function useTermsContentRequiredMessage(translationNamespace: FormTermsTranslationNamespace): string {
  const tEditor = useTranslations(translationNamespace)
  const tTerms  = useTranslations("formTermsEditor")
  return tTerms("contentRequired", { conditionsLabel: tEditor("conditionsLabel") })
}

// Scrolls to and focuses the checkbox whose error explains a refused save / publish. Deferred
// one frame so a step the caller has just expanded is laid out before scrolling.
export function revealFormTermsError() {
  requestAnimationFrame(() => {
    const requireAcceptanceInput = document.getElementById(REQUIRE_ACCEPTANCE_INPUT_ID)
    requireAcceptanceInput?.scrollIntoView({ behavior: "smooth", block: "center" })
    requireAcceptanceInput?.focus({ preventScroll: true })
  })
}

type FormTermsEditorProps = {
  translationNamespace:       FormTermsTranslationNamespace
  // Folder of the lazily uploaded document, e.g. "adhera/dons".
  uploadPrefix:               string
  conditions:                 string
  onConditionsChange:         (conditions: string) => void
  // Includes a picked-but-not-yet-uploaded document as a blob: entry (lazy-upload pattern).
  attachments:                FormTermsAttachment[]
  onAttachmentsChange:        (attachments: FormTermsAttachment[]) => void
  onPendingDocumentChange:    (pendingDocument: PendingTermsDocument | null) => void
  requireAcceptance:          boolean
  onRequireAcceptanceChange:  (requireAcceptance: boolean) => void
}

// The form-specific terms of the donation form, membership form and event editors: the
// "Conditions" text, one document, and whether visitors must accept them. Acceptance may only
// be required when there is text or a document to accept — the error sits under the checkbox
// for as long as that is not the case, including on a form saved before the rule existed.
export function FormTermsEditor({
  translationNamespace,
  uploadPrefix,
  conditions,
  onConditionsChange,
  attachments,
  onAttachmentsChange,
  onPendingDocumentChange,
  requireAcceptance,
  onRequireAcceptanceChange,
}: FormTermsEditorProps) {
  const tEditor = useTranslations(translationNamespace)
  const contentRequiredMessage = useTermsContentRequiredMessage(translationNamespace)
  const configurationValid = isTermsConfigurationValid({
    conditions,
    attachments,
    requireCguvSignature: requireAcceptance,
  })

  return (
    <>
      <RichTextEditor
        label={tEditor("conditionsLabel")}
        value={conditions}
        onChange={onConditionsChange}
        placeholder={tEditor("conditionsPlaceholder")}
      />
      <div className="space-y-1.5">
        <Label>{tEditor("conditionsPdfLabel")}</Label>
        <DocumentUpload
          value={attachments[0]?.url ?? ""}
          onChange={(url) => {
            if (url === "") {
              onPendingDocumentChange(null)
              onAttachmentsChange([])
            }
          }}
          prefix={uploadPrefix}
          lazy
          onFilePending={(blobUrl, file) => {
            onPendingDocumentChange({ blobUrl, file })
            onAttachmentsChange([{ url: blobUrl, filename: file.name, size: file.size }])
          }}
        />
      </div>
      <CheckboxField
        id={REQUIRE_ACCEPTANCE_INPUT_ID}
        label={tEditor("requireCguvLabel")}
        checked={requireAcceptance}
        onChange={(event) => onRequireAcceptanceChange(event.target.checked)}
        error={configurationValid ? undefined : contentRequiredMessage}
      />
    </>
  )
}
