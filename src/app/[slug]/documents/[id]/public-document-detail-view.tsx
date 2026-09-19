"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import { RichTextView, DOCUMENT_PROSE } from "@/components/ui/rich-text-view"
import { SitePublicChrome, type PublicSiteInfo } from "@/components/site/site-public-chrome"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { BASE_PATH } from "@/lib/env"
import type { Locale } from "@/i18n/locales"

type PublicDocument = { id: string; title: string; content: string; updatedAt: string }

// The route returns `site` even on a 404, so a stale link still renders the association's
// nav and footer around the "no longer available" message.
type ApiResponse = { document?: PublicDocument; site?: PublicSiteInfo; error?: string }

const LOADING_LINE_KEYS = ["first", "second", "third", "fourth", "fifth", "sixth"]

export function PublicDocumentDetailView({ slug, id }: { slug: string; id: string }) {
  const t             = useTranslations("publicDocuments")
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const listHref      = `/${slug}/documents`

  // BASE_PATH prefix: see the list view.
  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: ["public-association-document", slug, id],
    queryFn:  () => fetch(`${BASE_PATH}/api/public/${slug}/documents/${id}`).then(response => response.json()),
  })

  const site               = data?.site ?? { name: "", config: null }
  const associationDocument = data?.document

  return (
    <SitePublicChrome site={site} slug={slug}>
      <article className="mx-auto w-full max-w-3xl px-4 py-12">
        {/* Hidden when printing: someone printing their copy of the terms wants the text only. */}
        <Link href={listHref} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 print:hidden">
          <ArrowLeftIcon className="size-4" />
          {t("backToList")}
        </Link>

        {isLoading ? (
          <div className="mt-8 space-y-6">
            <div className="space-y-2">
              <div className="h-8 w-2/3 animate-pulse rounded bg-gray-100" />
              <div className="h-4 w-40 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="space-y-2">
              {LOADING_LINE_KEYS.map(lineKey => (
                <div key={lineKey} className="h-4 w-full animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          </div>
        ) : !associationDocument ? (
          <p className="mt-8 text-sm text-gray-500">{t("notFound")}</p>
        ) : (
          <>
            <header className="mt-8">
              <h1 className="text-2xl font-bold tracking-tight">{associationDocument.title}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {t("updatedAt", { date: format(new Date(associationDocument.updatedAt), "d MMMM yyyy", { locale: dateFnsLocale }) })}
              </p>
            </header>

            <RichTextView content={associationDocument.content} className={`${DOCUMENT_PROSE} mt-8`} />
          </>
        )}
      </article>
    </SitePublicChrome>
  )
}
