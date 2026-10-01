"use client"

import { useState } from "react"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Switch } from "@/components/ui/switch"
import { useSetSiteBuilder, useSiteDraft, type SiteBuilder } from "@/hooks/use-site-draft"

// Top of the legacy builder (/dashboard/site): which builder the public site renders. The new
// builder (FORM-7) can only go live once a version has been published from it.

type SiteBuilderSwitchBarProps = {
  canEdit: boolean
}

export function SiteBuilderSwitchBar({ canEdit }: SiteBuilderSwitchBarProps) {
  const t              = useTranslations("site.builderSwitch")
  const formatter      = useFormatter()
  const siteDraftQuery = useSiteDraft()
  const setSiteBuilder = useSetSiteBuilder()
  const [pendingSiteBuilder, setPendingSiteBuilder] = useState<SiteBuilder | null>(null)

  // Nothing to show until the state is known (or when it can't be read for this role).
  if (!siteDraftQuery.data) return null

  const { siteBuilder, publishedAt } = siteDraftQuery.data
  const isNewBuilderLive   = siteBuilder === "PUCK"
  const publishedDateLabel = publishedAt
    ? formatter.dateTime(new Date(publishedAt), { day: "numeric", month: "long", year: "numeric" })
    : null
  // Switching on needs a published version; switching off is always possible.
  const canSwitchOn   = publishedDateLabel !== null
  const switchEnabled = canEdit && (isNewBuilderLive || canSwitchOn) && !setSiteBuilder.isPending

  async function confirmSiteBuilderChange() {
    if (!pendingSiteBuilder) return
    try {
      await setSiteBuilder.mutateAsync(pendingSiteBuilder)
      toast.success(pendingSiteBuilder === "PUCK" ? t("toasts.switchedOn") : t("toasts.switchedOff"))
    } catch (switchError) {
      toast.error(switchError instanceof Error ? switchError.message : t("toasts.error"))
    } finally {
      setPendingSiteBuilder(null)
    }
  }

  return (
    <div className="shrink-0 border-b bg-background px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-medium">{t("liveVersionLabel")}</span>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={isNewBuilderLive}
            disabled={!switchEnabled}
            onCheckedChange={checked => setPendingSiteBuilder(checked ? "PUCK" : "LEGACY")}
          />
          {t("switchLabel")}
        </label>
        <span className="text-sm text-muted-foreground">
          {isNewBuilderLive && publishedDateLabel
            ? t("statusNewBuilder", { date: publishedDateLabel })
            : t("statusLegacy")}
          {canEdit && !isNewBuilderLive && !canSwitchOn && ` · ${t("publishFirstHint")}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          nativeButton={false}
          render={<Link href="/dashboard/site/puck" />}
        >
          {t("openNewBuilder")}
        </Button>
      </div>
      {isNewBuilderLive && (
        <p className="mt-1 text-xs text-muted-foreground">{t("legacyEditsNotice")}</p>
      )}

      <ConfirmDialog
        open={pendingSiteBuilder !== null}
        onOpenChange={open => { if (!open) setPendingSiteBuilder(null) }}
        title={pendingSiteBuilder === "PUCK" ? t("confirmOn.title") : t("confirmOff.title")}
        description={pendingSiteBuilder === "PUCK"
          ? t("confirmOn.description", { date: publishedDateLabel ?? "" })
          : t("confirmOff.description")}
        confirmLabel={pendingSiteBuilder === "PUCK" ? t("confirmOn.confirmLabel") : t("confirmOff.confirmLabel")}
        confirmVariant="default"
        loading={setSiteBuilder.isPending}
        onConfirm={confirmSiteBuilderChange}
      />
    </div>
  )
}
