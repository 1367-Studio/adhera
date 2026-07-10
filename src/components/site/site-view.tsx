"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"
import { useCurrentUser } from "@/lib/user-context"
import { useSiteConfig, useSaveSiteConfig } from "@/hooks/use-site-config"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { SiteControlsPanel } from "@/components/site/site-controls-panel"
import { SitePreviewPanel } from "@/components/site/site-preview-panel"
import type { SiteConfig } from "@/types/site-config"
import { DEFAULT_SITE_CONFIG } from "@/types/site-config"

const ADMINS = ["ADMIN", "PRESIDENT"]

type AssocData  = { name: string; slug: string; city: string | null; country: string }
type PublicEvent = {
  id: string; title: string; date: string; endDate: string | null
  location: string | null; description: string | null; price: string | null; capacity: number | null
}

export function SiteView() {
  const { role }    = useCurrentUser()
  const canEdit     = ADMINS.includes(role)

  const { data: siteData, isLoading } = useSiteConfig()
  const saveMutation = useSaveSiteConfig()

  const { data: assoc } = useQuery<AssocData>({
    queryKey: ["association"],
    queryFn:  () => fetch("/api/association").then(r => r.json()),
  })

  const { data: membreTypes = [] } = useMembreTypes()

  const { data: events = [] } = useQuery<PublicEvent[]>({
    queryKey: ["evenements-site-preview"],
    queryFn:  () =>
      fetch("/api/evenements?upcoming=true")
        .then(r => r.json())
        .then((data: { id: string; title: string; date: string; endDate: string | null; location: string | null; description: string | null; price: string | null; capacity: number | null }[]) =>
          data.map(e => ({ ...e, price: e.price != null ? String(e.price) : null }))
        ),
  })

  const [config, setConfig]     = useState<SiteConfig | null>(null)
  const [published, setPublished] = useState(false)
  const [isDirty, setIsDirty]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const initialized    = useRef(false)
  const pendingFiles   = useRef<Map<string, { file: File; prefix: string }>>(new Map())

  function handleFilePending(blobUrl: string, file: File, prefix: string) {
    pendingFiles.current.set(blobUrl, { file, prefix })
  }

  // Revoke any remaining blob URLs when component unmounts to prevent memory leaks
  useEffect(() => {
    const map = pendingFiles.current
    return () => { for (const url of map.keys()) URL.revokeObjectURL(url) }
  }, [])

  useEffect(() => {
    if (siteData && !initialized.current) {
      initialized.current = true
      setConfig(siteData.config ?? DEFAULT_SITE_CONFIG)
      setPublished(siteData.published)
    }
  }, [siteData])

  function updateConfig(patch: Partial<SiteConfig>) {
    setConfig(prev => prev ? { ...prev, ...patch } : { ...DEFAULT_SITE_CONFIG, ...patch })
    setIsDirty(true)
  }

  async function save() {
    if (!config) return
    setSaving(true)
    try {
      let finalConfig = config
      const pending = Array.from(pendingFiles.current.entries())

      if (pending.length > 0) {
        const configStr = JSON.stringify(config)
        // Only upload blob URLs still referenced in the current config
        const toUpload = pending.filter(([blobUrl]) => configStr.includes(blobUrl))

        if (toUpload.length > 0) {
          const settled = await Promise.allSettled(
            toUpload.map(async ([blobUrl, { file, prefix }]) => {
              const fd = new FormData()
              fd.append("file", file)
              fd.append("prefix", prefix)
              const res = await fetch("/api/upload", { method: "POST", body: fd })
              if (!res.ok) throw new Error("Upload failed")
              const { url } = (await res.json()) as { url: string }
              URL.revokeObjectURL(blobUrl)
              pendingFiles.current.delete(blobUrl)
              return { blobUrl, realUrl: url }
            })
          )
          const successes = settled
            .filter((r): r is PromiseFulfilledResult<{ blobUrl: string; realUrl: string }> => r.status === "fulfilled")
            .map(r => r.value)
          const failCount = settled.filter(r => r.status === "rejected").length
          if (failCount > 0) toast.warning(`${failCount} image(s) n'ont pas pu être téléchargées.`)
          let replaced = configStr
          for (const { blobUrl, realUrl } of successes) {
            replaced = replaced.replaceAll(blobUrl, realUrl)
          }
          finalConfig = JSON.parse(replaced) as SiteConfig
        }
      }

      await saveMutation.mutateAsync(finalConfig)
      setConfig(finalConfig)
      setIsDirty(false)
      toast.success("Site sauvegardé")
    } catch {
      toast.error("Erreur lors de la sauvegarde")
    } finally {
      setSaving(false)
    }
  }

  async function togglePublish() {
    if (isDirty) { toast.warning("Enregistrez vos modifications avant de publier."); return }
    const next = !published
    try {
      await saveMutation.mutateAsync({ published: next })
      setPublished(next)
      toast.success(next ? "Site publié" : "Site dépublié")
    } catch {
      toast.error("Erreur")
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center -mx-4">
        <div className="space-y-3 animate-pulse w-64">
          {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-muted" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-hidden -mx-4 -mb-4 lg:flex-row" style={{ height: "calc(100vh - 56px)" }}>
      {/* Left/top — controls */}
      <aside className="h-1/2 w-full shrink-0 border-b flex flex-col overflow-hidden bg-background lg:h-full lg:w-[360px] lg:border-b-0 lg:border-r">
        <SiteControlsPanel
          config={config}
          published={published}
          isDirty={isDirty}
          canEdit={canEdit}
          siteUrl={siteData?.slug ? `/${siteData.slug}` : null}
          isSaving={saving || saveMutation.isPending}
          onChange={updateConfig}
          onSave={save}
          onTogglePublish={togglePublish}
          onFilePending={handleFilePending}
        />
      </aside>

      {/* Right/bottom — live preview, only this scrolls */}
      <div className="h-1/2 flex-1 overflow-y-auto bg-gray-100 lg:h-full">
        <SitePreviewPanel
          config={config}
          name={assoc?.name ?? "Mon association"}
          slug={assoc?.slug ?? ""}
          city={assoc?.city ?? null}
          country={assoc?.country ?? "France"}
          membreTypes={membreTypes}
          events={events}
        />
      </div>
    </div>
  )
}
