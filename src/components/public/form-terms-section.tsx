"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { FileIcon } from "@phosphor-icons/react/dist/ssr"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { TermsModal } from "@/components/public/terms-modal"
import { publicFormTerms, type FormTermsAttachment } from "@/lib/form-terms"

type FormTermsSectionLabels = {
  viewConditions:  string
  conditionsTitle: string
  acceptConditions: string
}

type Props = {
  conditions:           string | null | undefined
  attachments:          FormTermsAttachment[] | null | undefined
  requireCguvSignature: boolean
  accepted:             boolean
  onAcceptedChange:     (accepted: boolean) => void
  labels:               FormTermsSectionLabels
  // Extra acceptance inputs grouped with the checkbox (e.g. the event's signed name);
  // rendered only when acceptance is actually required.
  acceptanceExtra?:     ReactNode
}

// The form-specific terms (donation forms, membership forms, events): the text behind a
// link, the uploaded documents, and the acceptance checkbox. Goes through publicFormTerms so
// an emptied editor ("<p></p>") never opens an empty modal and the checkbox only asks for
// something that exists. Renders nothing when there is neither text nor document.
// Distinct from LegalConsent (association-wide legal documents).
export function FormTermsSection({
  conditions: rawConditions,
  attachments: rawAttachments,
  requireCguvSignature,
  accepted,
  onAcceptedChange,
  labels,
  acceptanceExtra,
}: Props) {
  const tDocuments = useTranslations("publicDocuments")
  const { conditions, attachments, requiresTermsAcceptance } = publicFormTerms({
    conditions:  rawConditions,
    attachments: rawAttachments,
    requireCguvSignature,
  })

  if (conditions === null && attachments.length === 0) return null

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {conditions !== null && (
          <li>
            <TermsModal content={conditions} triggerLabel={labels.viewConditions} title={labels.conditionsTitle} />
          </li>
        )}
        {attachments.map(attachment => (
          <li key={attachment.url}>
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              <FileIcon className="size-3.5 shrink-0" />
              {attachment.filename}
              <span className="sr-only"> {tDocuments("opensNewTab")}</span>
            </a>
          </li>
        ))}
      </ul>

      {requiresTermsAcceptance && (
        <div className="space-y-2">
          <CheckboxField
            required
            label={labels.acceptConditions}
            checked={accepted}
            onChange={event => onAcceptedChange(event.target.checked)}
          />
          {acceptanceExtra}
        </div>
      )}
    </div>
  )
}
