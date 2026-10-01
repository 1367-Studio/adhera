"use client"

import "@puckeditor/core/puck.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { Puck, useGetPuck, type Viewports } from "@puckeditor/core"
import { toast } from "sonner"
import { sitePuckConfig } from "@/components/site/puck/site-puck-config"
import { SITE_PUCK_DICTIONARY_FR } from "@/components/site/puck/site-puck-dictionary"
import { useSitePuckMetadata } from "@/components/site/puck/use-site-puck-metadata"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSiteConfig } from "@/hooks/use-site-config"
import { useSaveSiteDraft, useSiteDraft } from "@/hooks/use-site-draft"
import { siteConfigToPuckData, type SitePuckData } from "@/lib/site-puck/site-puck-data"

// FORM-7 website builder. Opens the saved draft (Association.siteDraft) or, the first time,
// the current site converted from siteConfig. "Enregistrer" saves the draft; "Visualiser"
// opens it full page. The public site is not affected until publishing moves to this format.

const SITE_VIEWPORTS: Viewports = [
  { width: 390,  label: "Mobile",     icon: "Smartphone" },
  { width: 768,  label: "Tablette",   icon: "Tablet" },
  { width: 1280, label: "Ordinateur", icon: "Monitor" },
]

// Same height as the current builder: the dashboard header stays visible above the editor.
const EDITOR_HEIGHT = "calc(100dvh - 3.5rem)"

type SaveState = "saved" | "unsaved" | "saving"

export function SitePuckEditor() {
  const siteConfigQuery = useSiteConfig()
  const siteDraftQuery  = useSiteDraft()
  const saveSiteDraft   = useSaveSiteDraft()
  const metadata        = useSitePuckMetadata()

  const [saveState, setSaveState] = useState<SaveState>("saved")
  // Puck calls onChange once while mounting (resolving the loaded data): that first call is
  // not a change made by the volunteer.
  const hasSeenFirstChangeRef = useRef(false)

  // <Puck data> is read once on mount, so it is only built when both sources are in hand.
  const initialPuckData = useMemo<SitePuckData | null>(() => {
    if (!siteDraftQuery.data || !siteConfigQuery.data) return null
    return siteDraftQuery.data.draft ?? siteConfigToPuckData(siteConfigQuery.data.config)
  }, [siteDraftQuery.data, siteConfigQuery.data])

  // Leaving (reload, closing the tab, typing another URL) with unsaved work asks first.
  useEffect(() => {
    if (saveState === "saved") return
    function warnBeforeLeaving(beforeUnloadEvent: BeforeUnloadEvent) {
      beforeUnloadEvent.preventDefault()
    }
    window.addEventListener("beforeunload", warnBeforeLeaving)
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving)
  }, [saveState])

  async function saveDraft(puckData: SitePuckData): Promise<boolean> {
    setSaveState("saving")
    try {
      await saveSiteDraft.mutateAsync(puckData)
      setSaveState("saved")
      return true
    } catch (saveError) {
      setSaveState("unsaved")
      toast.error(saveError instanceof Error ? saveError.message : "Erreur lors de l'enregistrement")
      return false
    }
  }

  function handleChange() {
    if (!hasSeenFirstChangeRef.current) {
      hasSeenFirstChangeRef.current = true
      return
    }
    setSaveState("unsaved")
  }

  if (siteDraftQuery.isError) {
    return <p className="p-6 text-sm text-destructive">Impossible de charger le brouillon du site. Rechargez la page.</p>
  }

  if (!initialPuckData || !metadata) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <Puck
      config={sitePuckConfig}
      data={initialPuckData}
      metadata={metadata}
      onChange={handleChange}
      viewports={SITE_VIEWPORTS}
      iframe={{ enabled: true, waitForStyles: true }}
      height={EDITOR_HEIGHT}
      headerTitle="Site web"
      dictionary={SITE_PUCK_DICTIONARY_FR}
      overrides={{
        // Replaces Puck's own "Publier" button: publishing to the live site comes later.
        headerActions: () => <SitePuckHeaderActions saveState={saveState} onSave={saveDraft} />,
      }}
    />
  )
}

type SitePuckHeaderActionsProps = {
  saveState: SaveState
  onSave:    (puckData: SitePuckData) => Promise<boolean>
}

// Rendered inside <Puck>, so it can read the page being edited at the moment of the click.
function SitePuckHeaderActions({ saveState, onSave }: SitePuckHeaderActionsProps) {
  const getPuck = useGetPuck()

  function readCurrentPage(): SitePuckData {
    return getPuck().appState.data as SitePuckData
  }

  async function handleSave() {
    if (await onSave(readCurrentPage())) toast.success("Brouillon enregistré")
  }

  // The preview shows the saved draft, so unsaved work is saved first. The tab is opened
  // synchronously (inside the click) so pop-up blockers let it through, then pointed at the
  // preview once the save has finished.
  async function handlePreview() {
    const previewWindow = window.open("", "_blank")
    if (saveState !== "saved" && !(await onSave(readCurrentPage()))) {
      previewWindow?.close()
      return
    }
    // Built from the current path so the /app basePath is kept.
    const previewUrl = `${window.location.origin}${window.location.pathname.replace(/\/site\/puck.*$/, "/site/puck/apercu")}`
    if (previewWindow) previewWindow.location.href = previewUrl
    else window.open(previewUrl, "_blank")
  }

  // Cmd/Ctrl+S saves, like any editor.
  useEffect(() => {
    function saveOnShortcut(keyboardEvent: KeyboardEvent) {
      if ((keyboardEvent.metaKey || keyboardEvent.ctrlKey) && keyboardEvent.key.toLowerCase() === "s") {
        keyboardEvent.preventDefault()
        void onSave(getPuck().appState.data as SitePuckData)
      }
    }
    window.addEventListener("keydown", saveOnShortcut)
    return () => window.removeEventListener("keydown", saveOnShortcut)
  }, [getPuck, onSave])

  const saveStateLabel =
    saveState === "saving" ? "Enregistrement…"
    : saveState === "unsaved" ? "Modifications non enregistrées"
    : "Enregistré"

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">{saveStateLabel}</span>
      <Button variant="secondary" size="sm" onClick={() => void handlePreview()} disabled={saveState === "saving"}>
        Visualiser
      </Button>
      <Button size="sm" onClick={() => void handleSave()} disabled={saveState === "saving"}>
        Enregistrer
      </Button>
    </div>
  )
}
