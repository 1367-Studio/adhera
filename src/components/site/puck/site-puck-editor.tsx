"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useGetPuck } from "@puckeditor/core"
import { useFormatter } from "next-intl"
import { toast } from "sonner"
import { SidebarSimpleIcon, FilesIcon } from "@phosphor-icons/react/dist/ssr"
import { sitePuckConfig } from "@/components/site/puck/site-puck-config"
import { SitePuckBuilderShell, type SaveState } from "@/components/site/puck/site-puck-builder-shell"
import { useSitePuckMetadata } from "@/components/site/puck/use-site-puck-metadata"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useSiteConfig } from "@/hooks/use-site-config"
import { usePublishSiteDraft, useSaveSiteDraft, useSiteDraft, type SiteBuilder } from "@/hooks/use-site-draft"
import { siteConfigToPuckData, type SitePuckData } from "@/lib/site-puck/site-puck-data"

// FORM-7 website builder. Opens the saved draft (Association.siteDraft) or, the first time,
// the current site converted from siteConfig. "Enregistrer" saves the draft; "Visualiser"
// opens it full page; "Publier" saves it, makes it the published version and switches the
// association to the new builder — visitors see it right away. The legacy page (Site web)
// still offers a manual switch to revert to the old builder if needed.

export function SitePuckEditor() {
  const siteConfigQuery = useSiteConfig()
  const siteDraftQuery  = useSiteDraft()
  const saveSiteDraft   = useSaveSiteDraft()
  const publishSiteDraft = usePublishSiteDraft()
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

  async function publishDraft(puckData: SitePuckData): Promise<boolean> {
    setSaveState("saving")
    try {
      await publishSiteDraft.mutateAsync(puckData)
      setSaveState("saved")
      return true
    } catch (publishError) {
      setSaveState("unsaved")
      toast.error(publishError instanceof Error ? publishError.message : "Erreur lors de la publication")
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

  return (
    <SitePuckBuilderShell
      config={sitePuckConfig}
      initialData={initialPuckData}
      metadata={metadata}
      headerTitle="Site web"
      onChange={handleChange}
      loadError={siteDraftQuery.isError}
      loadErrorMessage="Impossible de charger le brouillon du site. Rechargez la page."
      headerActions={() => (
        <SitePuckHeaderActions
          saveState={saveState}
          publishedAt={siteDraftQuery.data?.publishedAt ?? null}
          siteBuilder={siteDraftQuery.data?.siteBuilder ?? "LEGACY"}
          onSave={saveDraft}
          onPublish={publishDraft}
        />
      )}
    />
  )
}

type SitePuckHeaderActionsProps = {
  saveState:   SaveState
  publishedAt: string | null
  siteBuilder: SiteBuilder
  onSave:      (puckData: SitePuckData) => Promise<boolean>
  onPublish:   (puckData: SitePuckData) => Promise<boolean>
}

// Rendered inside <Puck>, so it can read the page being edited at the moment of the click.
function SitePuckHeaderActions({ saveState, publishedAt, siteBuilder, onSave, onPublish }: SitePuckHeaderActionsProps) {
  const getPuck   = useGetPuck()
  const router    = useRouter()
  const formatter = useFormatter()
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  // Puck's own left panel (Components + Outline) — local state because useGetPuck is the
  // non-reactive escape hatch (it doesn't re-render this component), so the button's own
  // pressed state is tracked here and kept in sync with the dispatch that actually moves it.
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)

  function toggleLeftSidebar() {
    const next = !leftSidebarOpen
    getPuck().dispatch({ type: "setUi", ui: { leftSideBarVisible: next } })
    setLeftSidebarOpen(next)
  }

  function readCurrentPage(): SitePuckData {
    return getPuck().appState.data as SitePuckData
  }

  async function handleSave() {
    if (await onSave(readCurrentPage())) toast.success("Brouillon enregistré")
  }

  async function handlePublish() {
    setPublishConfirmOpen(false)
    if (await onPublish(readCurrentPage())) {
      toast.success("Site publié")
    }
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

  const publishedAtLabel = publishedAt
    ? `Publié le ${formatter.dateTime(new Date(publishedAt), { day: "numeric", month: "long", year: "numeric" })}`
    : null

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={toggleLeftSidebar}
        aria-label={leftSidebarOpen ? "Masquer le panneau" : "Afficher le panneau"}
        aria-pressed={!leftSidebarOpen}
      >
        <SidebarSimpleIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/dashboard/site/pages")}
      >
        <FilesIcon className="size-4" />
        Pages
      </Button>
      <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
        {saveStateLabel}
        {publishedAtLabel && ` · ${publishedAtLabel}`}
      </span>
      <Button variant="secondary" size="sm" onClick={() => void handlePreview()} disabled={saveState === "saving"}>
        Visualiser
      </Button>
      <Button variant="outline" size="sm" onClick={() => void handleSave()} disabled={saveState === "saving"}>
        Enregistrer
      </Button>
      <Button size="sm" onClick={() => setPublishConfirmOpen(true)} disabled={saveState === "saving"}>
        Publier
      </Button>
      <ConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        title="Publier le site ?"
        description={siteBuilder === "PUCK"
          ? "Les visiteurs verront cette version immédiatement."
          : "Cette publication remplacera votre site actuel (ancien éditeur) par cette version, visible immédiatement par vos visiteurs."}
        confirmLabel="Publier"
        confirmVariant="default"
        loading={saveState === "saving"}
        onConfirm={handlePublish}
      />
    </div>
  )
}
