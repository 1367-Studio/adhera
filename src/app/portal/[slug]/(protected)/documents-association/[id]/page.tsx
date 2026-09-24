"use client"

import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { usePortalAssociationDocument } from "@/hooks/use-association-documents"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { RichTextView, DOCUMENT_PROSE } from "@/components/ui/rich-text-view"
import { Skeleton } from "@/components/ui/skeleton"
import { AssociationDocumentPdf } from "@/components/association-documents/association-document-pdf"
import { stripHtml } from "@/lib/utils"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

const LOADING_LINE_KEYS = ["first", "second", "third", "fourth", "fifth", "sixth"]

export default function PortalAssociationDocumentPage() {
  const t             = useTranslations("portalMembre.associationDocuments")
  const locale        = useLocale()
  const dateFnsLocale = getDateFnsLocale(locale as Locale)
  const { slug, id }  = useParams<{ slug: string; id: string }>()
  const listHref      = `/portal/${slug}/documents-association`
  const { data: associationDocument, isLoading, isError } = usePortalAssociationDocument(id)

  // The portal API answers 404 for a hidden or deleted document as well as a missing one,
  // so every failure lands on the same "no longer available" state.
  if (!isLoading && (isError || !associationDocument)) {
    return <DetailNotFound message={t("notFound")} backHref={listHref} backLabel={t("backToList")} />
  }

  return (
    <article className="max-w-3xl space-y-6">
      {/* BackLink takes no className, so the print exclusion sits on a wrapper. */}
      <div className="print:hidden">
        <BackLink href={listHref}>{t("backToList")}</BackLink>
      </div>

      {isLoading || !associationDocument ? (
        <>
          <div className="space-y-2">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-2">
            {LOADING_LINE_KEYS.map(lineKey => (
              <Skeleton key={lineKey} className="h-4 w-full" />
            ))}
          </div>
        </>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{associationDocument.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("updatedAt", { date: format(new Date(associationDocument.updatedAt), "d MMMM yyyy", { locale: dateFnsLocale }) })}
            </p>
          </div>

          {associationDocument.fileUrl && (
            <AssociationDocumentPdf
              fileUrl={associationDocument.fileUrl}
              fileName={associationDocument.fileName}
              documentTitle={associationDocument.title}
              openLabel={t("openPdf")}
              opensNewTabLabel={t("opensNewTab")}
            />
          )}

          {/* A PDF-only document stores "" (or an emptied editor's markup) as its content. */}
          {stripHtml(associationDocument.content).length > 0 && (
            <RichTextView content={associationDocument.content} className={DOCUMENT_PROSE} />
          )}
        </>
      )}
    </article>
  )
}
