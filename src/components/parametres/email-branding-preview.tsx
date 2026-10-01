"use client"

import { useTranslations } from "next-intl"
import { RichTextView } from "@/components/ui/rich-text-view"
import { isColorDark } from "@/lib/color"
import { cn } from "@/lib/utils"
import { EMAIL_FOOTER_SOCIAL_PLATFORMS, EMAIL_FOOTER_SOCIAL_LABEL, type EmailFooterSettings } from "@/lib/email-footer"

interface EmailBrandingPreviewProps {
  logoUrl:         string
  accentColor:     string
  associationName: string
  senderName:      string
  signatureHtml:   string
  footer:          EmailFooterSettings
  className?:      string
}

const DEFAULT_ACCENT = "#18181b"

// A lightweight mockup of the shared email layout() (src/lib/email.ts) — not the actual
// rendered HTML (that only exists server-side, built for a specific email's content), just
// enough of the same visual structure — colored header strip, logo/name, footer — that an
// admin can see what their branding choices actually look like without sending a test email
// first. Mirrors the same "form beside a live preview" layout already used for the member
// card (member-card-settings.tsx + MemberCard).
export function EmailBrandingPreview({
  logoUrl, accentColor, associationName, senderName, signatureHtml, footer, className,
}: EmailBrandingPreviewProps) {
  const t = useTranslations("parametres.branding.preview")
  const accent = accentColor || DEFAULT_ACCENT
  const displayName = senderName || associationName || t("placeholderName")

  const footerLinks = EMAIL_FOOTER_SOCIAL_PLATFORMS
    .map(platform => ({ platform, url: footer.socialLinks[platform] }))
    .filter((e): e is { platform: typeof e.platform; url: string } => !!e.url?.trim())

  const footerBg = footer.style === "bold" ? (footer.color || accent) : undefined
  const footerFg = footerBg ? (isColorDark(footerBg) ? "#ffffff" : "#111827") : undefined
  const footerText = footer.text || t("defaultFooter", { name: associationName || t("placeholderName") })

  const socialRow = footerLinks.length > 0 && (
    <p className="mb-1.5 text-[11px]">
      {footerLinks.map(({ platform, url }, i) => (
        <span key={platform}>
          {i > 0 && <span className="opacity-50"> · </span>}
          <a href={url} target="_blank" rel="noreferrer" className="font-semibold underline-offset-2 hover:underline" style={footerFg ? { color: footerFg } : undefined}>
            {EMAIL_FOOTER_SOCIAL_LABEL[platform]}
          </a>
        </span>
      ))}
    </p>
  )

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      <div style={{ background: accent }} className="h-1" />
      <div className="flex items-center gap-3 border-b px-5 py-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview only, not a real page image
          <img src={logoUrl} alt={associationName} className="h-8 max-w-[140px] object-contain" />
        ) : (
          <span className="text-base font-bold tracking-tight">{associationName || t("placeholderName")}</span>
        )}
      </div>
      <div className="space-y-2 px-5 py-6">
        <p className="text-sm font-semibold">{t("sampleHeading")}</p>
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-muted" />
          <div className="h-2 w-4/5 rounded-full bg-muted" />
        </div>
        <div
          className="mt-3 inline-block rounded-md px-4 py-2 text-xs font-semibold"
          style={{ background: accent, color: isColorDark(accent) ? "#ffffff" : "#111827" }}
        >
          {t("sampleButton")}
        </div>
        {signatureHtml && (
          <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            <RichTextView content={signatureHtml} />
          </div>
        )}
      </div>
      <div
        className={cn(
          "px-5 text-center text-[11px] whitespace-pre-wrap",
          footer.style === "classic" && "border-t bg-muted/30 py-3 text-muted-foreground",
          footer.style === "bold" && "py-3",
          footer.style === "minimal" && "py-2 text-[10px] text-muted-foreground/70",
        )}
        style={footerFg ? { background: footerBg, color: footerFg } : undefined}
      >
        {socialRow}
        {footerText}
      </div>
      <p className="border-t px-5 py-2 text-center text-[10px] text-muted-foreground/70">{t("fromLabel", { name: displayName })}</p>
    </div>
  )
}
