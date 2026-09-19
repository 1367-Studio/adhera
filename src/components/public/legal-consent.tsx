"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { CheckboxField } from "@/components/ui/checkbox-field"

// One document the association requires agreement to, at the revision in force. `revisionId`
// is what the form sends back on submit — see src/lib/legal/acceptance.ts.
export type RequiredLegalDocument = {
  documentId: string
  revisionId: string
  version:    number
  title:      string
}

type Props = {
  slug:      string
  documents: RequiredLegalDocument[]
  checked:   boolean
  onChange:  (checked: boolean) => void
  error?:    string
  disabled?: boolean
}

// The single consent control for every public flow (adhesion, dons, evenements, boutique,
// portal registration). One component so the wording, the links and the required-field
// behaviour cannot drift between them.
//
// Renders nothing when the association requires no document: a form should not show an empty
// "I accept" box.
export function LegalConsent({ slug, documents, checked, onChange, error, disabled }: Props) {
  const t = useTranslations("legalConsent")

  if (documents.length === 0) return null

  return (
    <CheckboxField
      required
      checked={checked}
      disabled={disabled}
      onChange={event => onChange(event.target.checked)}
      error={error}
      label={
        <>
          {t("agreeLabel", { count: documents.length })}{" "}
          {documents.map((document, index) => (
            <span key={document.documentId}>
              {index > 0 && ", "}
              {/* next/link so the app's basePath is applied, a new tab so a half-filled form is
                  never lost to reading the terms, and stopPropagation so following the link
                  does not also tick the box it sits inside. */}
              <Link
                href={`/${slug}/documents/${document.documentId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
                onClick={event => event.stopPropagation()}
              >
                {document.title}
              </Link>
            </span>
          ))}
        </>
      }
    />
  )
}
