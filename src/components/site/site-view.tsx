"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { useCurrentUser, useModules } from "@/lib/user-context"
import { useSiteConfig, useSaveSiteConfig } from "@/hooks/use-site-config"
import { useDonationForms } from "@/hooks/use-donation-forms"
import { SiteControlsPanel } from "@/components/site/site-controls-panel"
import { SitePreviewPanel } from "@/components/site/site-preview-panel"
import type { SiteConfig } from "@/types/site-config"
import { DEFAULT_SITE_CONFIG } from "@/types/site-config"
import {
  changedDonationFormAssignments,
  resolveDonationFormBySection,
  stripDonationFormPicks,
  usesDonationForms,
} from "@/lib/dons/site-section-picks"

const ADMINS = ["ADMIN", "PRESIDENT"]

type AssocData  = { name: string; slug: string; city: string | null; country: string }
type PublicEvent = {
  id: string; slug: string | null; title: string; date: string; endDate: string | null
  location: string | null; description: string | null; imageUrl: string | null
  price: string | null; capacity: number | null
  ticketTypes: { id: string; label: string; price: string; remaining: number | null; full: boolean }[]
}
type PublicActualite = {
  id: string; title: string; content: string; imageUrl: string | null
  pinned: boolean; publishedAt: string
}
type PublicBoutiqueProduit = {
  id: string; name: string; imageUrl: string | null
  variantes: { price: number }[]
}
type FormBinding = { slug: string; title: string }
type SitePreviewData = {
  actualites: PublicActualite[]
  boutiqueProduits: PublicBoutiqueProduit[]
  membershipFormBySection: Record<string, FormBinding>
  donationFormBySection: Record<string, FormBinding>
  usesDonationForms: boolean
  membershipCta: { href: string } | null
  canIssueTaxReceipts: boolean
}

export function SiteView() {
  const t           = useTranslations("site.view")
  const { role }    = useCurrentUser()
  const canEdit     = ADMINS.includes(role)
  const modules     = useModules()

  const { data: siteData, isLoading } = useSiteConfig()
  const saveMutation = useSaveSiteConfig()

  const { data: assoc } = useQuery<AssocData>({
    queryKey: ["association"],
    queryFn:  () => fetch("/api/association").then(r => r.json()),
  })

  const { data: events = [] } = useQuery<PublicEvent[]>({
    queryKey: ["evenements-site-preview"],
    queryFn:  () =>
      fetch("/api/evenements?upcoming=true")
        .then(r => r.json())
        .then((data: PublicEvent[]) =>
          data.map(e => ({ ...e, price: e.price != null ? String(e.price) : null }))
        ),
  })

  const { data: previewData } = useQuery<SitePreviewData>({
    queryKey: ["site-preview-data"],
    queryFn:  () => fetch("/api/site-preview-data").then(r => r.json()),
  })

  // Only site editors can pick a form (the list is FINANCE-gated, and both editor roles are
  // in FINANCE); everyone else previews the saved bindings from site-preview-data.
  const { data: donationForms } = useDonationForms({ enabled: canEdit && modules.dons })

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
          if (failCount > 0) toast.warning(t("uploadFailedWarning", { count: failCount }))
          let replaced = configStr
          for (const { blobUrl, realUrl } of successes) {
            replaced = replaced.replaceAll(blobUrl, realUrl)
          }
          finalConfig = JSON.parse(replaced) as SiteConfig
        }
      }

      // Form picks from the section sheet go out as assignments applied to the forms, never
      // inside siteConfig itself.
      const donsFormAssignments = donationForms ? changedDonationFormAssignments(finalConfig.sections, donationForms) : {}
      const persistedConfig     = stripDonationFormPicks(finalConfig)
      await saveMutation.mutateAsync({
        ...persistedConfig,
        ...(Object.keys(donsFormAssignments).length > 0 ? { donsFormAssignments } : {}),
      })
      setConfig(persistedConfig)
      setIsDirty(false)
      toast.success(t("toasts.saved"))
    } catch {
      toast.error(t("toasts.saveError"))
    } finally {
      setSaving(false)
    }
  }

  async function togglePublish() {
    if (isDirty) { toast.warning(t("toasts.publishFirst")); return }
    const next = !published
    try {
      await saveMutation.mutateAsync({ published: next })
      setPublished(next)
      toast.success(next ? t("toasts.published") : t("toasts.unpublished"))
    } catch {
      toast.error(t("toasts.error"))
    }
  }

  // Draft-aware once the form list is in: a form picked in the section sheet shows in the
  // preview right away, before anything is saved.
  const draftDonationFormBySection: Record<string, FormBinding> = donationForms && config
    ? Object.fromEntries(
        Object.entries(resolveDonationFormBySection(config.sections, donationForms))
          .flatMap(([sectionId, donationForm]) => donationForm ? [[sectionId, { slug: donationForm.slug, title: donationForm.title }]] : []),
      )
    : previewData?.donationFormBySection ?? {}

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
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden -mx-4 -mb-4 md:h-auto md:min-h-0 md:flex-1 lg:flex-row">
      {/* Left/top — controls */}
      <aside className="h-1/2 w-full shrink-0 border-b flex flex-col overflow-hidden bg-background lg:h-full lg:w-[360px] lg:border-b-0 lg:border-r">
        <SiteControlsPanel
          config={config}
          published={published}
          isDirty={isDirty}
          canEdit={canEdit}
          aiEnabled={modules.ia}
          siteUrl={siteData?.slug ? `/${siteData.slug}` : null}
          isSaving={saving || saveMutation.isPending}
          donsModuleEnabled={modules.dons}
          boutiqueModuleEnabled={modules.boutique}
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
          name={assoc?.name ?? t("defaultAssociationName")}
          slug={assoc?.slug ?? ""}
          city={assoc?.city ?? null}
          country={assoc?.country ?? "France"}
          events={events}
          actualites={previewData?.actualites ?? []}
          boutiqueProduits={previewData?.boutiqueProduits ?? []}
          membershipFormBySection={previewData?.membershipFormBySection ?? {}}
          donationFormBySection={draftDonationFormBySection}
          usesDonationForms={donationForms ? usesDonationForms(donationForms) : previewData?.usesDonationForms ?? false}
          membershipCta={previewData?.membershipCta ?? null}
          canIssueTaxReceipts={previewData?.canIssueTaxReceipts ?? false}
          donsEnabled={modules.dons}
          boutiqueEnabled={modules.boutique}
        />
      </div>
    </div>
  )
}
