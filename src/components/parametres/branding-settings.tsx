"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { CrownIcon } from "@phosphor-icons/react/dist/ssr";
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { ImageUpload } from "@/components/ui/image-upload"
import { ColorField } from "@/components/ui/color-field"
import { FormField } from "@/components/ui/form-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control"
import { EmailBrandingPreview } from "@/components/parametres/email-branding-preview"
import { SITE_DEFAULT_PRIMARY_COLOR } from "@/lib/site-theme"
import {
  EMAIL_FOOTER_STYLES, EMAIL_FOOTER_SOCIAL_PLATFORMS, parseEmailFooterSettings,
  type EmailFooterStyle, type EmailFooterSettings, type EmailFooterSocialPlatform,
} from "@/lib/email-footer"

type BrandingData = {
  logoUrl:             string | null
  primaryColor:        string | null
  emailSenderName:     string | null
  emailSignature:      string | null
  emailFooterSettings: unknown
  // Only used as the sender-name field's placeholder — never sent back to the API.
  associationName:     string
}

interface BrandingSettingsProps {
  canEdit: boolean
  canUse:  boolean
  data:    BrandingData
}

export function BrandingSettings({ canEdit, canUse, data }: BrandingSettingsProps) {
  const t       = useTranslations("parametres.branding")
  const tCommon = useTranslations("common")
  const qc     = useQueryClient()
  const router = useRouter()

  const [logoUrl, setLogoUrl]           = useState(data.logoUrl ?? "")
  const [primaryColor, setPrimaryColor] = useState(data.primaryColor ?? "")
  const [senderName, setSenderName]     = useState(data.emailSenderName ?? "")
  const [signature, setSignature]       = useState(data.emailSignature ?? "")
  const [footer, setFooter]             = useState<EmailFooterSettings>(() => parseEmailFooterSettings(data.emailFooterSettings))
  const [dirty, setDirty]               = useState(false)
  // Same lazy-upload pattern as the site builder (src/components/site/site-view.tsx):
  // picking a file only creates a local blob: preview, the real /api/upload only happens
  // at save time — so cancelling out of this screen never leaves an orphaned file in R2.
  const [pendingFile, setPendingFile] = useState<{ blobUrl: string; file: File } | null>(null)

  useEffect(() => {
    setLogoUrl(data.logoUrl ?? "")
    setPrimaryColor(data.primaryColor ?? "")
    setSenderName(data.emailSenderName ?? "")
    setSignature(data.emailSignature ?? "")
    setFooter(parseEmailFooterSettings(data.emailFooterSettings))
    setDirty(false)
  }, [data])

  useEffect(() => {
    if (!pendingFile) return
    return () => URL.revokeObjectURL(pendingFile.blobUrl)
  }, [pendingFile])

  function handleLogoChange(url: string) {
    if (url === "") setPendingFile(null) // "Retirer" clicked — nothing left to upload
    setLogoUrl(url)
    setDirty(true)
  }

  function handleFilePending(blobUrl: string, file: File) {
    setPendingFile({ blobUrl, file })
    setDirty(true)
  }

  function updateFooter(patch: Partial<EmailFooterSettings>) {
    setFooter(f => ({ ...f, ...patch }))
    setDirty(true)
  }

  function updateSocialLink(platform: EmailFooterSocialPlatform, url: string) {
    setFooter(f => ({ ...f, socialLinks: { ...f.socialLinks, [platform]: url || null } }))
    setDirty(true)
  }

  const footerStyleOptions: SegmentedControlOption<EmailFooterStyle>[] = EMAIL_FOOTER_STYLES.map(style => ({
    value: style,
    label: t(`footerStyles.${style}`),
  }))

  const mutation = useMutation({
    mutationFn: async () => {
      let finalLogoUrl = logoUrl
      if (pendingFile) {
        const fd = new FormData()
        fd.append("file", pendingFile.file)
        fd.append("prefix", "brand-logo")
        const uploadRes = await fetch("/api/upload", { method: "POST", body: fd })
        if (!uploadRes.ok) throw new Error(t("toasts.uploadError"))
        finalLogoUrl = ((await uploadRes.json()) as { url: string }).url
      }

      const res = await fetch("/api/association/branding", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          logoUrl:         finalLogoUrl,
          primaryColor,
          emailSenderName: senderName,
          emailSignature:  signature,
          emailFooterSettings: footer,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(typeof d.error === "string" ? d.error : tCommon("error"))
      }
      return { logoUrl: finalLogoUrl }
    },
    onSuccess: ({ logoUrl: savedLogoUrl }) => {
      setPendingFile(null)
      setLogoUrl(savedLogoUrl)
      qc.invalidateQueries({ queryKey: ["association"] })
      // The sidebar logo comes from the layout server component
      // (src/app/dashboard/layout.tsx), not this page's own fetch — refresh()
      // re-renders it with the new DB value without a full page reload.
      router.refresh()
      toast.success(t("toasts.updated"))
      setDirty(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  if (!canUse) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <div className="flex items-start gap-2 rounded-lg border p-4 text-xs text-muted-foreground">
          <CrownIcon className="size-3.5 shrink-0 mt-0.5 text-amber-500" />
          <span>{t("proOnlyText")}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Same "preview follows the form" placement as the member card settings screen —
            on a phone it comes first since the options only make sense once you've seen what
            they change; on a wide screen it moves to the right and stays in view while
            scrolling the (taller) form beside it. */}
        <div className="order-first space-y-2 lg:order-last lg:sticky lg:top-6 lg:self-start">
          <p className="text-xs font-medium text-muted-foreground">{t("preview.label")}</p>
          <EmailBrandingPreview
            logoUrl={logoUrl}
            accentColor={primaryColor}
            associationName={data.associationName}
            senderName={senderName}
            signatureHtml={signature}
            footer={footer}
          />
        </div>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("logo")}</Label>
            <ImageUpload
              value={logoUrl || undefined}
              onChange={handleLogoChange}
              prefix="brand-logo"
              aspectRatio="square"
              className="w-40"
              lazy
              onFilePending={handleFilePending}
            />
          </div>

          <ColorField
            label={t("color")}
            description={t("colorHint")}
            value={primaryColor}
            onChange={color => { setPrimaryColor(color); setDirty(true) }}
            placeholder={SITE_DEFAULT_PRIMARY_COLOR}
            fallbackColor={SITE_DEFAULT_PRIMARY_COLOR}
            className="max-w-xs"
          />

          <FormField
            label={t("senderName")}
            hint={t("senderNameHint")}
            value={senderName}
            onChange={e => { setSenderName(e.target.value); setDirty(true) }}
            placeholder={data.associationName}
            className="max-w-sm"
          />

          <RichTextEditor
            label={t("signature")}
            hint={t("signatureHint")}
            value={signature}
            onChange={html => { setSignature(html); setDirty(true) }}
            minHeight="100px"
          />

          <div className="space-y-4 rounded-lg border p-4">
            <div>
              <Label className="text-xs">{t("footer.title")}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{t("footer.subtitle")}</p>
            </div>

            <SegmentedControl
              options={footerStyleOptions}
              value={footer.style}
              onChange={style => updateFooter({ style })}
              size="sm"
            />

            {footer.style === "bold" && (
              <ColorField
                label={t("footer.color")}
                value={footer.color ?? primaryColor}
                onChange={color => updateFooter({ color })}
                placeholder={SITE_DEFAULT_PRIMARY_COLOR}
                fallbackColor={primaryColor || SITE_DEFAULT_PRIMARY_COLOR}
                className="max-w-xs"
              />
            )}

            <FormField
              label={t("footerText")}
              hint={t("footerTextHint")}
              value={footer.text ?? ""}
              onChange={e => updateFooter({ text: e.target.value || null })}
              placeholder={t("footerTextPlaceholder", { name: data.associationName })}
              className="max-w-sm"
            />

            <div className="space-y-2">
              <Label className="text-xs">{t("footer.socialLinks")}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {EMAIL_FOOTER_SOCIAL_PLATFORMS.map(platform => (
                  <FormField
                    key={platform}
                    label={t(`footer.socialPlatforms.${platform}`)}
                    value={footer.socialLinks[platform] ?? ""}
                    onChange={e => updateSocialLink(platform, e.target.value)}
                    placeholder="https://…"
                  />
                ))}
              </div>
            </div>
          </div>

          {canEdit && (
            <Button
              size="sm"
              disabled={!dirty}
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {tCommon("save")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
