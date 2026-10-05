"use client"

import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { useAssociationDocument, type AssociationDocument } from "@/hooks/use-association-documents"
import { AssociationDocumentForm } from "@/components/association-documents/association-document-form"
import { BackLink } from "@/components/ui/back-link"
import { PageHeader } from "@/components/ui/page-header"
import { RichTextView, DOCUMENT_PROSE } from "@/components/ui/rich-text-view"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { useHasAccess } from "@/lib/user-context"
import type { Locale } from "@/i18n/locales"

const ASSOCIATION_DOCUMENTS_PATH = "/dashboard/documents-association"

export function AssociationDocumentEditView({ documentId }: { documentId: string }) {
  const t = useTranslations("associationDocuments")
  // Same check as PATCH/DELETE /api/association-documents/[id]: a reader gets the document,
  // not the editor.
  const canEditDocuments = useHasAccess("documents", "edit")
  // No refetch on window focus: coming back to the tab must never swap the document under
  // unsaved edits. Saves still refresh the cache through the mutation's invalidation.
  const { data: document, isLoading } = useAssociationDocument(documentId, { refetchOnWindowFocus: false })

  if (isLoading) return <DetailLoadingSkeleton />
  // Keyed on data, not isError: a failed background refetch keeps the cached document, and
  // unmounting the form over it would throw away whatever the manager was writing.
  if (!document) {
    return (
      <DetailNotFound
        message={t("notFound")}
        backHref={ASSOCIATION_DOCUMENTS_PATH}
        backLabel={t("backToList")}
      />
    )
  }

  if (!canEditDocuments) return <AssociationDocumentReadOnlyView document={document} />

  return <AssociationDocumentForm key={document.id} document={document} />
}

function AssociationDocumentReadOnlyView({ document }: { document: AssociationDocument }) {
  const t             = useTranslations("associationDocuments")
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)

  const visibilityLabels = [
    document.visibleToMembers ? t("visibleToMembers") : t("hidden"),
    ...(document.visibleToPublic ? [t("visibleToPublic")] : []),
    ...(document.requiresAcceptance ? [t("requiresAcceptance")] : []),
  ]

  return (
    <div className="space-y-4">
      <BackLink href={ASSOCIATION_DOCUMENTS_PATH}>{t("backToList")}</BackLink>

      <PageHeader
        title={document.title}
        description={`${t("form.updatedAt", { date: format(new Date(document.updatedAt), "d MMMM yyyy", { locale: dateFnsLocale }) })} · ${visibilityLabels.join(" · ")}`}
      />

      <div className="max-w-3xl space-y-5">
        {document.fileUrl && (
          <a
            href={document.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium underline underline-offset-4"
          >
            {document.fileName ?? t("form.fileLabel")}
          </a>
        )}
        <RichTextView content={document.content} className={DOCUMENT_PROSE} />
      </div>
    </div>
  )
}
