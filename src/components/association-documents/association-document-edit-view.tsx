"use client"

import { useTranslations } from "next-intl"
import { useAssociationDocument } from "@/hooks/use-association-documents"
import { AssociationDocumentForm } from "@/components/association-documents/association-document-form"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { DetailNotFound } from "@/components/ui/detail-not-found"

export function AssociationDocumentEditView({ documentId }: { documentId: string }) {
  const t = useTranslations("associationDocuments")
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
        backHref="/dashboard/documents-association"
        backLabel={t("backToList")}
      />
    )
  }

  return <AssociationDocumentForm key={document.id} document={document} />
}
