"use client"

import "@puckeditor/core/puck.css"
import Link from "next/link"
import { Render } from "@puckeditor/core"
import { sitePuckConfig } from "@/components/site/puck/site-puck-config"
import { useSitePuckMetadata } from "@/components/site/puck/use-site-puck-metadata"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSiteConfig } from "@/hooks/use-site-config"
import { useSiteDraft } from "@/hooks/use-site-draft"
import { siteConfigToPuckData } from "@/lib/site-puck/site-puck-data"

// Full-page view of the saved draft, rendered by Puck's <Render> exactly as visitors will see
// it once published. Covers the dashboard chrome (sidebar, header) so breakpoints and widths
// are the real ones.
export function SitePuckPreview() {
  const siteDraftQuery  = useSiteDraft()
  const siteConfigQuery = useSiteConfig()
  const metadata        = useSitePuckMetadata()

  const pageData = siteDraftQuery.data && siteConfigQuery.data
    ? siteDraftQuery.data.draft ?? siteConfigToPuckData(siteConfigQuery.data.config)
    : null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b bg-background px-4">
        <p className="truncate text-xs text-muted-foreground">
          Aperçu du brouillon enregistré — pas encore visible par les visiteurs
        </p>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/site/puck" />}>
          Retour à l&apos;éditeur
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {siteDraftQuery.isError ? (
          <p className="p-6 text-sm text-destructive">Impossible de charger le brouillon du site.</p>
        ) : !pageData || !metadata ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <Render config={sitePuckConfig} data={pageData} metadata={metadata} />
        )}
      </div>
    </div>
  )
}
