"use client"

import "@puckeditor/core/puck.css"
import { Puck, type Config, type Viewports } from "@puckeditor/core"
import { SITE_PUCK_DICTIONARY_FR } from "@/components/site/puck/site-puck-dictionary"
import { Skeleton } from "@/components/ui/skeleton"
import type { SitePuckMetadata } from "@/components/site/blocks/site-block-types"
import type { SitePuckComponents, SitePuckRootProps, SitePuckData } from "@/lib/site-puck/site-puck-data"

// The Puck canvas itself (viewports, dictionary, iframe, height, header title) shared by the
// home page editor (SitePuckEditor, sitePuckConfig) and a custom page's editor (SitePageEditor,
// sitePageConfig) — everything that differs between the two (data source, save/publish wiring,
// header actions) stays in each editor's own thin wrapper.

export const SITE_VIEWPORTS: Viewports = [
  { width: 390,  label: "Mobile",     icon: "Smartphone" },
  { width: 768,  label: "Tablette",   icon: "Tablet" },
  { width: 1280, label: "Ordinateur", icon: "Monitor" },
]

// Same height as the dashboard header, which stays visible above the editor.
export const EDITOR_HEIGHT = "calc(100dvh - 3.5rem)"

export type SaveState = "saved" | "unsaved" | "saving"

type SitePuckBuilderShellProps = {
  config:           Config<SitePuckComponents, SitePuckRootProps>
  initialData:      SitePuckData | null
  metadata:         SitePuckMetadata | null
  headerTitle:      string
  onChange:         () => void
  headerActions:    () => React.ReactElement
  loadError?:       boolean
  loadErrorMessage?: string
}

export function SitePuckBuilderShell({
  config, initialData, metadata, headerTitle, onChange, headerActions, loadError, loadErrorMessage,
}: SitePuckBuilderShellProps) {
  if (loadError) {
    return <p className="p-6 text-sm text-destructive">{loadErrorMessage ?? "Impossible de charger la page. Rechargez la page."}</p>
  }

  if (!initialData || !metadata) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <Puck
      config={config}
      data={initialData}
      metadata={metadata}
      onChange={onChange}
      viewports={SITE_VIEWPORTS}
      iframe={{ enabled: true, waitForStyles: true }}
      height={EDITOR_HEIGHT}
      headerTitle={headerTitle}
      dictionary={SITE_PUCK_DICTIONARY_FR}
      overrides={{ headerActions }}
    />
  )
}
