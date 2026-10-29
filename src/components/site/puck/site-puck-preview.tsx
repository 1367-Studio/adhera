"use client"

import "@puckeditor/core/puck.css"
import Link from "next/link"
import { Render } from "@puckeditor/core"
import { sitePuckConfig } from "@/components/site/puck/site-puck-config"
import { RICH_TEXT_STYLES } from "@/components/site/puck/site-puck-rich-text-styles"
import { useSitePuckMetadata } from "@/components/site/puck/use-site-puck-metadata"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSiteConfig } from "@/hooks/use-site-config"
import { useSiteDraft } from "@/hooks/use-site-draft"
import { siteConfigToPuckData } from "@/lib/site-puck/site-puck-data"

type SitePuckPreviewProps = {
  // Whether the viewer can open the editor — false for anyone with only "site" read access
  // (FORM-34), who lands here directly and has nowhere to "go back" to.
  canEdit: boolean
}

// Rendered by Puck's <Render>, content only, no editor chrome. Covers the dashboard chrome
// (sidebar, header) so breakpoints and widths are the real ones. Two different audiences:
// - Opened from the editor ("Visualiser") by someone who can edit — shows their saved draft,
//   falling back to the legacy content converted to Puck format if nothing was drafted yet
//   (the same seed the editor itself starts a blank draft from — not "showing the old site",
//   just a starting point for someone about to edit).
// - The one "site" screen read-only access unlocks — shows ONLY what's actually published
//   from the new builder (sitePuckPublished). Never the legacy site, not even as a fallback:
//   the legacy editor is discontinued and nobody should see it in any form. If nothing has
//   been published yet, this says so instead of silently substituting the old site.
export function SitePuckPreview({ canEdit }: SitePuckPreviewProps) {
  const siteDraftQuery  = useSiteDraft()
  const siteConfigQuery = useSiteConfig()
  const metadata        = useSitePuckMetadata()

  const legacyAsPuckData = siteConfigQuery.data ? siteConfigToPuckData(siteConfigQuery.data.config) : null

  const isNotYetPublished = !canEdit
    && !!siteDraftQuery.data
    && (siteDraftQuery.data.siteBuilder !== "PUCK" || !siteDraftQuery.data.publishedData)

  const pageData = canEdit
    ? (siteDraftQuery.data && legacyAsPuckData ? siteDraftQuery.data.draft ?? legacyAsPuckData : null)
    : (siteDraftQuery.data?.siteBuilder === "PUCK" ? siteDraftQuery.data.publishedData : null)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b bg-background px-4">
        <p className="truncate text-xs text-muted-foreground">
          {canEdit
            ? "Aperçu du brouillon enregistré — pas encore visible par les visiteurs"
            : "Version actuellement visible par vos visiteurs"}
        </p>
        {canEdit && (
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/site/puck" />}>
            Retour à l&apos;éditeur
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {siteDraftQuery.isError ? (
          <p className="p-6 text-sm text-destructive">Impossible de charger le brouillon du site.</p>
        ) : isNotYetPublished ? (
          <p className="p-6 text-sm text-muted-foreground">Le site n&apos;a pas encore été publié depuis le nouvel éditeur.</p>
        ) : !pageData || !metadata ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div data-site-puck-page="">
            <style href="site-puck-rich-text" precedence="default">{RICH_TEXT_STYLES}</style>
            <Render config={sitePuckConfig} data={pageData} metadata={metadata} />
          </div>
        )}
      </div>
    </div>
  )
}
