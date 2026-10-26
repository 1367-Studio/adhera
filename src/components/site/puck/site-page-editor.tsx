"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useGetPuck } from "@puckeditor/core"
import { useFormatter } from "next-intl"
import { toast } from "sonner"
import { ArrowLeftIcon, ListIcon, PlusIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr"
import { sitePageConfig } from "@/components/site/puck/site-puck-config"
import { SitePuckBuilderShell, type SaveState } from "@/components/site/puck/site-puck-builder-shell"
import { useSitePuckMetadata } from "@/components/site/puck/use-site-puck-metadata"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useSiteConfig } from "@/hooks/use-site-config"
import { useSiteDraft } from "@/hooks/use-site-draft"
import {
  useSitePage, useSaveSitePage, usePublishSitePage, useUnpublishSitePage, type SitePageDetail,
} from "@/hooks/use-site-pages"
import { useSiteNavMenus, useCreateSiteNavMenu } from "@/hooks/use-site-nav-menus"
import { MAX_SITE_NAV_MENUS } from "@/lib/site-puck/site-nav-menu"
import { siteConfigToPuckData, type SitePuckData } from "@/lib/site-puck/site-puck-data"

// FORM-7 "Pages": one more page on the new builder's site beyond the single home page
// (site-puck-editor.tsx). Same editor canvas (SitePuckBuilderShell, sitePageConfig — no root
// settings panel, theme/header/footer stay the home page's), with its own save/publish/
// unpublish wiring and a "Dans le menu" placement control instead of "Visualiser" (there is no
// standalone preview route for a draft custom page).

type SitePageEditorProps = { pageId: string }

export function SitePageEditor({ pageId }: SitePageEditorProps) {
  const router = useRouter()
  const sitePageQuery = useSitePage(pageId)
  // Read-only: only used to pre-fill the chrome (header/footer/theme) the page previews with —
  // never written back. Prefers what visitors actually see; falls back to the draft so the
  // chrome still renders before the home page's first publish.
  const siteDraftQuery  = useSiteDraft()
  // A site that never touched the new builder yet has neither sitePuckPublished nor siteDraft —
  // its chrome still exists as the legacy siteConfig, the same source the home page editor
  // bootstraps its own first Puck document from (site-puck-editor.tsx).
  const siteConfigQuery = useSiteConfig()
  const metadata        = useSitePuckMetadata()
  const saveSitePage      = useSaveSitePage(pageId)
  const publishSitePage   = usePublishSitePage(pageId)
  const unpublishSitePage = useUnpublishSitePage(pageId)

  const [saveState, setSaveState] = useState<SaveState>("saved")
  const hasSeenFirstChangeRef = useRef(false)

  const chromeRootProps =
    siteDraftQuery.data?.publishedData?.root.props
    ?? siteDraftQuery.data?.draft?.root.props
    ?? (siteConfigQuery.data ? siteConfigToPuckData(siteConfigQuery.data.config).root.props : undefined)

  const initialPuckData = useMemo<SitePuckData | null>(() => {
    if (!sitePageQuery.data || !chromeRootProps) return null
    // draftContent's blocks are loosely typed (the server only validates the outer Puck shape,
    // not each block's props field by field — see site-page-schema.ts) — same trust boundary
    // as useSiteDraft's own `draft: SitePuckData`.
    return {
      root:    { props: chromeRootProps },
      content: sitePageQuery.data.draftContent.content,
      zones:   sitePageQuery.data.draftContent.zones ?? {},
    } as SitePuckData
  }, [sitePageQuery.data, chromeRootProps])

  useEffect(() => {
    if (saveState === "saved") return
    function warnBeforeLeaving(beforeUnloadEvent: BeforeUnloadEvent) {
      beforeUnloadEvent.preventDefault()
    }
    window.addEventListener("beforeunload", warnBeforeLeaving)
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving)
  }, [saveState])

  async function savePage(puckData: SitePuckData): Promise<boolean> {
    setSaveState("saving")
    try {
      await saveSitePage.mutateAsync({ content: puckData.content, zones: puckData.zones ?? {} })
      setSaveState("saved")
      return true
    } catch (saveError) {
      setSaveState("unsaved")
      toast.error(saveError instanceof Error ? saveError.message : "Erreur lors de l'enregistrement")
      return false
    }
  }

  async function publishPage(puckData: SitePuckData): Promise<boolean> {
    setSaveState("saving")
    try {
      await publishSitePage.mutateAsync({ content: puckData.content, zones: puckData.zones ?? {} })
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

  if (sitePageQuery.isError) {
    return <p className="p-6 text-sm text-destructive">Impossible de charger cette page. Rechargez la page.</p>
  }

  return (
    <SitePuckBuilderShell
      config={sitePageConfig}
      initialData={initialPuckData}
      metadata={metadata}
      headerTitle={sitePageQuery.data?.title ?? "Page"}
      onChange={handleChange}
      headerActions={() => (
        <SitePageHeaderActions
          sitePage={sitePageQuery.data ?? null}
          saveState={saveState}
          onBack={() => router.push("/dashboard/site/pages")}
          onSave={savePage}
          onPublish={publishPage}
          onUnpublish={() => unpublishSitePage.mutateAsync()}
          onSaveNav={update => saveSitePage.mutateAsync(update)}
        />
      )}
    />
  )
}

type SitePageHeaderActionsProps = {
  sitePage:    SitePageDetail | null
  saveState:   SaveState
  onBack:      () => void
  onSave:      (puckData: SitePuckData) => Promise<boolean>
  onPublish:   (puckData: SitePuckData) => Promise<boolean>
  onUnpublish: () => Promise<unknown>
  onSaveNav:   (update: { showInNav?: boolean; navLabel?: string | null; navMenuId?: string | null }) => Promise<unknown>
}

// Rendered inside <Puck>, so it can read the page being edited at the moment of the click.
function SitePageHeaderActions({
  sitePage, saveState, onBack, onSave, onPublish, onUnpublish, onSaveNav,
}: SitePageHeaderActionsProps) {
  const getPuck   = useGetPuck()
  const formatter = useFormatter()
  const [publishConfirmOpen, setPublishConfirmOpen]     = useState(false)
  const [unpublishConfirmOpen, setUnpublishConfirmOpen] = useState(false)
  const [unpublishing, setUnpublishing]                 = useState(false)

  function readCurrentPage(): SitePuckData {
    return getPuck().appState.data as SitePuckData
  }

  async function handleSave() {
    if (await onSave(readCurrentPage())) toast.success("Brouillon enregistré")
  }

  async function handlePublish() {
    setPublishConfirmOpen(false)
    if (await onPublish(readCurrentPage())) toast.success("Page publiée")
  }

  async function handleUnpublish() {
    setUnpublishing(true)
    try {
      await onUnpublish()
      toast.success("Page dépubliée")
      setUnpublishConfirmOpen(false)
    } catch (unpublishError) {
      toast.error(unpublishError instanceof Error ? unpublishError.message : "Erreur lors de la dépublication")
    } finally {
      setUnpublishing(false)
    }
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

  const publishedAtLabel = sitePage?.publishedAt
    ? `Publié le ${formatter.dateTime(new Date(sitePage.publishedAt), { day: "numeric", month: "long", year: "numeric" })}`
    : null

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" className="size-8" onClick={onBack} aria-label="Retour aux pages">
        <ArrowLeftIcon className="size-4" />
      </Button>
      {sitePage && <SitePageNavPopover sitePage={sitePage} onSaveNav={onSaveNav} />}
      <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
        {saveStateLabel}
        {publishedAtLabel && ` · ${publishedAtLabel}`}
      </span>
      <Button variant="outline" size="sm" onClick={() => void handleSave()} disabled={saveState === "saving"}>
        Enregistrer
      </Button>
      {sitePage?.status === "PUBLISHED" && (
        <Button variant="outline" size="sm" onClick={() => setUnpublishConfirmOpen(true)}>
          Dépublier
        </Button>
      )}
      <Button size="sm" onClick={() => setPublishConfirmOpen(true)} disabled={saveState === "saving"}>
        Publier
      </Button>
      <ConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        title="Publier cette page ?"
        description="Les visiteurs pourront y accéder immédiatement."
        confirmLabel="Publier"
        confirmVariant="default"
        loading={saveState === "saving"}
        onConfirm={handlePublish}
      />
      <ConfirmDialog
        open={unpublishConfirmOpen}
        onOpenChange={setUnpublishConfirmOpen}
        title="Dépublier cette page ?"
        description="Elle ne sera plus accessible aux visiteurs tant qu'elle n'est pas republiée."
        confirmLabel="Dépublier"
        confirmVariant="default"
        loading={unpublishing}
        onConfirm={handleUnpublish}
      />
    </div>
  )
}

type SitePageNavPopoverProps = {
  sitePage:  SitePageDetail
  onSaveNav: (update: { showInNav?: boolean; navLabel?: string | null; navMenuId?: string | null }) => Promise<unknown>
}

// A page's own header button, not grouped into any dropdown — the Select below needs a
// non-empty value even for this choice (Base UI's Select has no "none" sentinel of its own).
const NAV_MENU_BUTTON_VALUE = "__button__"

// Visibility + label + dropdown placement — the order among pages (and among menus themselves)
// is set from the list screen's up/down arrows (site-pages-view.tsx / SiteNavMenusModal), not
// here: a free-form position field on a single page can't meaningfully express "between these
// two others".
function SitePageNavPopover({ sitePage, onSaveNav }: SitePageNavPopoverProps) {
  const siteNavMenusQuery = useSiteNavMenus()
  const createSiteNavMenu = useCreateSiteNavMenu()

  const [showInNav, setShowInNav] = useState(sitePage.showInNav)
  const [navLabel, setNavLabel]   = useState(sitePage.navLabel ?? "")
  const [navMenuId, setNavMenuId] = useState(sitePage.navMenuId)
  const [saving, setSaving]       = useState(false)
  const [creatingMenu, setCreatingMenu]   = useState(false)
  const [newMenuLabel, setNewMenuLabel]   = useState("")

  const siteNavMenus = siteNavMenusQuery.data ?? []
  const atMenuCap    = siteNavMenus.length >= MAX_SITE_NAV_MENUS

  async function persist(update: { showInNav?: boolean; navLabel?: string | null; navMenuId?: string | null }) {
    setSaving(true)
    try {
      await onSaveNav(update)
    } catch (saveNavError) {
      toast.error(saveNavError instanceof Error ? saveNavError.message : "Erreur lors de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateMenu() {
    // Guards a mashed Enter / fast double-click: without this, a second call fires while the
    // first's request is still in flight and creates two identical menus.
    if (createSiteNavMenu.isPending || atMenuCap) return
    const label = newMenuLabel.trim()
    if (!label) return
    try {
      const { siteNavMenu } = await createSiteNavMenu.mutateAsync({ label })
      setNavMenuId(siteNavMenu.id)
      setCreatingMenu(false)
      setNewMenuLabel("")
      await persist({ navMenuId: siteNavMenu.id })
    } catch (createMenuError) {
      toast.error(createMenuError instanceof Error ? createMenuError.message : "Erreur lors de la création du menu")
    }
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
        <ListIcon className="size-4" />
        Dans le menu
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="site-page-show-in-nav">Afficher dans le menu du site</Label>
          <Switch
            id="site-page-show-in-nav"
            checked={showInNav}
            disabled={saving}
            onCheckedChange={checked => {
              setShowInNav(checked)
              void persist({ showInNav: checked })
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="site-page-nav-label">Libellé du menu</Label>
          <Input
            id="site-page-nav-label"
            placeholder={sitePage.title}
            value={navLabel}
            disabled={saving}
            onChange={event => setNavLabel(event.target.value)}
            onBlur={() => void persist({ navLabel: navLabel.trim() || null })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Emplacement</Label>
          <div className="flex items-center gap-1">
            <Select
              value={navMenuId ?? NAV_MENU_BUTTON_VALUE}
              disabled={saving}
              onValueChange={value => {
                const nextNavMenuId = value === NAV_MENU_BUTTON_VALUE ? null : value
                setNavMenuId(nextNavMenuId)
                void persist({ navMenuId: nextNavMenuId })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {navMenuId ? (siteNavMenus.find(menu => menu.id === navMenuId)?.label ?? "…") : "Bouton indépendant"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NAV_MENU_BUTTON_VALUE}>Bouton indépendant</SelectItem>
                {siteNavMenus.length > 0 && <SelectSeparator />}
                {siteNavMenus.map(menu => (
                  <SelectItem key={menu.id} value={menu.id}>{menu.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!creatingMenu && (
              <Button
                variant="ghost" size="icon-sm" disabled={saving || atMenuCap}
                onClick={() => setCreatingMenu(true)} aria-label="Nouveau menu"
              >
                <PlusIcon className="size-3.5" />
              </Button>
            )}
          </div>
          {creatingMenu && (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                placeholder="Nom du menu"
                aria-label="Nom du nouveau menu"
                value={newMenuLabel}
                disabled={createSiteNavMenu.isPending}
                onChange={event => setNewMenuLabel(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter") void handleCreateMenu() }}
              />
              <Button
                variant="outline" size="icon-sm"
                disabled={!newMenuLabel.trim() || createSiteNavMenu.isPending}
                onClick={() => void handleCreateMenu()} aria-label="Créer le menu"
              >
                <CheckIcon className="size-3.5" />
              </Button>
            </div>
          )}
          {!creatingMenu && atMenuCap && (
            <p className="text-xs text-muted-foreground">Limite de {MAX_SITE_NAV_MENUS} menus atteinte.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
