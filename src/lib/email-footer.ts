import { z } from "zod"

// Visual layouts the email footer can be rendered with — layout() (src/lib/email.ts) owns
// what each one actually looks like; this list only fixes which names are valid to store.
// Same "classic/bold/minimal" naming as MEMBER_CARD_TEMPLATES (src/lib/member-card/
// settings.ts) — same concept (a small set of preset visual treatments an admin picks from),
// kept consistent on purpose.
export const EMAIL_FOOTER_STYLES = ["classic", "bold", "minimal"] as const
export type EmailFooterStyle = (typeof EMAIL_FOOTER_STYLES)[number]

// Same "#RRGGBB" shape as Association.primaryColor.
export const EMAIL_FOOTER_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

// Text links, not icon images: an inline <svg> icon doesn't render in most mail clients, and
// there's no icon asset hosted anywhere in this codebase to reference as an <img> instead —
// plain text stays legible and clickable everywhere without needing one.
export const EMAIL_FOOTER_SOCIAL_PLATFORMS = ["facebook", "instagram", "linkedin", "x"] as const
export type EmailFooterSocialPlatform = (typeof EMAIL_FOOTER_SOCIAL_PLATFORMS)[number]

// Shared between the actual email renderer (renderFooterSocialLinks() in src/lib/email.ts)
// and the settings-screen live preview (email-branding-preview.tsx), so the two can't drift
// on what a platform is called.
export const EMAIL_FOOTER_SOCIAL_LABEL: Record<EmailFooterSocialPlatform, string> = {
  facebook:  "Facebook",
  instagram: "Instagram",
  linkedin:  "LinkedIn",
  x:         "X",
}

// Strict shape, for validating what an admin submits (see /api/association/branding) — an
// invalid value there should be a 422, not silently replaced by a default.
export const emailFooterSettingsSchema = z.object({
  style: z.enum(EMAIL_FOOTER_STYLES),
  // null = "no colour chosen": the renderer falls back to its own default (the association's
  // accentColor, then a neutral grey) instead of storing one here — changing that fallback
  // later reaches every association that never picked one, same reasoning as
  // MEMBER_CARD_COLOR's null.
  color: z.string().regex(EMAIL_FOOTER_COLOR_PATTERN).nullable(),
  // Overrides the default "Email automatique envoyé par X via Formwise..." line — null keeps
  // that default. Plain text (rendered with white-space:pre-wrap), not HTML.
  text: z.string().max(500).nullable(),
  socialLinks: z.object({
    facebook:  z.string().max(500).nullable(),
    instagram: z.string().max(500).nullable(),
    linkedin:  z.string().max(500).nullable(),
    x:         z.string().max(500).nullable(),
  }),
})

export type EmailFooterSettings = z.infer<typeof emailFooterSettingsSchema>

export const DEFAULT_EMAIL_FOOTER_SETTINGS: EmailFooterSettings = {
  style: "classic",
  color: null,
  text:  null,
  socialLinks: { facebook: null, instagram: null, linkedin: null, x: null },
}

// Lenient twin of emailFooterSettingsSchema for *reading* Association.emailFooterSettings:
// each field falls back to its own default on its own (`.catch`), so one bad or missing key
// (a hand-edited row, a key added by a later version) never resets the others.
const storedEmailFooterSettingsSchema = z.object({
  style: emailFooterSettingsSchema.shape.style.catch(DEFAULT_EMAIL_FOOTER_SETTINGS.style),
  color: emailFooterSettingsSchema.shape.color.catch(DEFAULT_EMAIL_FOOTER_SETTINGS.color),
  text:  emailFooterSettingsSchema.shape.text.catch(DEFAULT_EMAIL_FOOTER_SETTINGS.text),
  socialLinks: z.object({
    facebook:  z.string().nullable().catch(null),
    instagram: z.string().nullable().catch(null),
    linkedin:  z.string().nullable().catch(null),
    x:         z.string().nullable().catch(null),
  }).catch(DEFAULT_EMAIL_FOOTER_SETTINGS.socialLinks),
})

// The only way Association.emailFooterSettings (Json?) should be read. null — an association
// that never opened the branding settings — and anything that isn't an object both yield the
// defaults (the original fixed footer, unstyled).
export function parseEmailFooterSettings(raw: unknown): EmailFooterSettings {
  const parsed = storedEmailFooterSettingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : { ...DEFAULT_EMAIL_FOOTER_SETTINGS, socialLinks: { ...DEFAULT_EMAIL_FOOTER_SETTINGS.socialLinks } }
}
