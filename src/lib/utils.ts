import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

// A bare "example.org" would be stored as a relative href and resolve against whatever page
// renders it — prepend a scheme unless the user already gave one. Shared by rich-text-editor's
// link popover and email-block-editor's button/image link fields, so both editors correct a
// forgotten "https://" the same way instead of one of them silently producing a dead link.
// Leaves a {{variable}} token (e.g. {{lien_renouvellement}}, {{lien_portal}}) alone — it isn't
// a real URL yet at edit time, substituteVars() resolves it into one at send time, and
// prepending "https://" here would corrupt it into "https://{{lien_renouvellement}}".
export function normalizeHref(raw: string): string {
  const v = raw.trim()
  if (!v || v.startsWith("{{")) return v
  return /^(https?:|mailto:|tel:)/i.test(v) ? v : `https://${v}`
}
