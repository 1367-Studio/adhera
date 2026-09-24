"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"
import { usePortalAssociationDocuments } from "@/hooks/use-association-documents"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

const LOADING_ROW_KEYS = ["first", "second", "third"]

// Not a module and not in PORTAL_NAV_ORDER: reached from the portal sidebar footer, which
// only shows the entry when at least one document is visible to members. The (protected)
// layout already enforces the session and association slug, so no section layout is needed.
export default function PortalAssociationDocumentsPage() {
  const t             = useTranslations("portalMembre.associationDocuments")
  const locale        = useLocale()
  const dateFnsLocale = getDateFnsLocale(locale as Locale)
  const { slug }      = useParams<{ slug: string }>()
  const { data: documents, isLoading, isError } = usePortalAssociationDocuments()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card overflow-hidden">
          {LOADING_ROW_KEYS.map(rowKey => (
            <div key={rowKey} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <EmptyState title={t("loadError")} />
      ) : !documents?.length ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          {documents.map(associationDocument => (
            <Link
              key={associationDocument.id}
              href={`/portal/${slug}/documents-association/${associationDocument.id}`}
              className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{associationDocument.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t("updatedAt", { date: format(new Date(associationDocument.updatedAt), "d MMM yyyy", { locale: dateFnsLocale }) })}
                  {associationDocument.fileUrl ? ` · ${t("pdfShort")}` : ""}
                </p>
              </div>
              <CaretRightIcon className="size-4 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
