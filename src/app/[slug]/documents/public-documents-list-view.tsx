"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"
import { SitePublicChrome, type PublicSiteInfo } from "@/components/site/site-public-chrome"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { BASE_PATH } from "@/lib/env"
import type { Locale } from "@/i18n/locales"

type PublicDocumentSummary = { id: string; title: string; updatedAt: string }

type ApiResponse = { documents?: PublicDocumentSummary[]; site?: PublicSiteInfo; error?: string }

const LOADING_ROW_KEYS = ["first", "second", "third"]

export function PublicDocumentsListView({ slug }: { slug: string }) {
  const t             = useTranslations("publicDocuments")
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)

  // BASE_PATH prefix: the app is served under /app, and a bare "/api/…" from the browser
  // resolves against the origin root, where Next has no route.
  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: ["public-association-documents", slug],
    queryFn:  () => fetch(`${BASE_PATH}/api/public/${slug}/documents`).then(response => response.json()),
  })

  const site      = data?.site ?? { name: "", config: null }
  const documents = data?.documents ?? []
  // The route answers 404 without a `site` when the slug matches no association. Without this
  // an unknown slug rendered the ordinary empty state, which reads as "this association has
  // published nothing" — a very different thing, and a confusing one to debug.
  const associationMissing = !isLoading && !data?.site

  return (
    <SitePublicChrome site={site} slug={slug}>
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        {!associationMissing && <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>}

        <div className="mt-8">
          {associationMissing ? (
            <p className="text-sm text-gray-500">{t("associationNotFound")}</p>
          ) : isLoading ? (
            <div className="divide-y divide-gray-200 border-y border-gray-200">
              {LOADING_ROW_KEYS.map(rowKey => (
                <div key={rowKey} className="space-y-2 py-4">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-32 animate-pulse rounded bg-gray-100" />
                </div>
              ))}
            </div>
          ) : documents.length === 0 ? (
            <p className="text-sm text-gray-500">{t("empty")}</p>
          ) : (
            <div className="divide-y divide-gray-200 border-y border-gray-200">
              {documents.map(associationDocument => (
                <Link
                  key={associationDocument.id}
                  href={`/${slug}/documents/${associationDocument.id}`}
                  className="flex items-center gap-3 py-4 transition-colors hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{associationDocument.title}</span>
                    <span className="block text-xs text-gray-500">
                      {t("updatedAt", { date: format(new Date(associationDocument.updatedAt), "d MMMM yyyy", { locale: dateFnsLocale }) })}
                    </span>
                  </span>
                  <CaretRightIcon className="size-4 shrink-0 text-gray-400" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </SitePublicChrome>
  )
}
