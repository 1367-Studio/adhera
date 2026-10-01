// Visual block-based email design — the source of truth behind MessageTemplate.blocks (see
// prisma/schema.prisma). renderBlocksToHtml() is the only place this shape turns into the
// HTML actually stored in MessageTemplate.body and sent via customEmail() (src/lib/email.ts).
// Runs server-side only (called from /api/message-templates on save), so the stored `body`
// never drifts from the design.

import { z } from "zod"
import { isColorDark } from "@/lib/color"
import { normalizeHref } from "@/lib/utils"
import { toProxiedAssetUrl } from "@/lib/r2"

export type EmailBlock =
  | { id: string; type: "text";    html: string }
  | { id: string; type: "image";   url: string; alt?: string; linkUrl?: string }
  | { id: string; type: "button";  label: string; url: string; color?: string; textColor?: string }
  | { id: string; type: "divider" }

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

// Shared by both /api/message-templates routes (create + update) so the two never drift on
// what a valid block looks like.
export const emailBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("text"),    html: z.string() }),
  z.object({ id: z.string(), type: z.literal("image"),   url: z.string().max(1000), alt: z.string().max(200).optional(), linkUrl: z.string().max(1000).optional() }),
  z.object({ id: z.string(), type: z.literal("button"),  label: z.string().max(100), url: z.string().max(1000), color: z.string().regex(HEX_COLOR).optional(), textColor: z.string().regex(HEX_COLOR).optional() }),
  z.object({ id: z.string(), type: z.literal("divider") }),
])

// Only what renderBlocksToHtml needs from an association's branding — deliberately not the
// full EmailBranding type from email.ts, so this module has no dependency on it.
export type EmailBlockBranding = { accentColor?: string | null }

const DEFAULT_BUTTON_COLOR = "#18181b"

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Blocks come from admin-entered URLs (button/image link fields) — a bare "javascript:" or
// "data:" href would execute in the recipient's mail client on click. Only http(s)/mailto/tel
// are ever legitimate destinations for an email link. normalizeHref() first turns a bare
// "example.org" (an easy thing to type without noticing) into "https://example.org" — the
// same correction email-block-editor.tsx applies live in the field — so only a genuinely
// unsafe scheme falls through to "#", not just a forgotten "https://".
//
// A {{variable}} token (e.g. {{lien_renouvellement}}) passes through as-is instead of being
// scheme-checked: at this point (render time, i.e. template save time) it's still literal
// placeholder text, not a URL — substituteVars() turns it into a real one later, at actual
// send time, on this function's already-rendered output. Safe to trust here because the
// caller (/api/message-templates) runs findUnknownVars() on the exact string this produces
// right after, rejecting anything that isn't one of the app's own known tokens.
function sanitizeHref(url: string): string {
  const normalized = normalizeHref(url)
  if (normalized.startsWith("{{")) return escapeHtml(normalized)
  if (/^(https?:|mailto:|tel:)/i.test(normalized)) return escapeHtml(normalized)
  return "#"
}

function renderText(block: Extract<EmailBlock, { type: "text" }>): string {
  // Trusted HTML from RichTextEditor (Tiptap) — same trust level customEmail() already
  // gives an admin-composed bodyHtml today, so no extra escaping here.
  return `<div style="font-size:15px;line-height:1.6;color:#3f3f46;">${block.html}</div>`
}

function renderImage(block: Extract<EmailBlock, { type: "image" }>): string {
  const img = `<img src="${escapeHtml(toProxiedAssetUrl(block.url))}" alt="${escapeHtml(block.alt ?? "")}" width="480" style="display:block;width:100%;max-width:480px;height:auto;border:0;">`
  const inner = block.linkUrl ? `<a href="${sanitizeHref(block.linkUrl)}" style="border:0;">${img}</a>` : img
  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td align="center">${inner}</td></tr></table>`
}

// Same table-button shape as btn() in email.ts, so a block-designed email's CTA looks like
// every other Formwise email's CTA — just with a per-block color instead of the fixed ACCENT.
function renderButton(block: Extract<EmailBlock, { type: "button" }>, branding?: EmailBlockBranding): string {
  const color = block.color || branding?.accentColor || DEFAULT_BUTTON_COLOR
  // Unlike btn() in email.ts (always the fixed near-black ACCENT, so always white text
  // safely), this color is admin-chosen and could be light — auto-contrast is only the
  // *default* here, not the only option: block.textColor, when the admin explicitly picked
  // one in the editor, always wins over the computed guess.
  const textColor = block.textColor || (isColorDark(color) ? "#ffffff" : "#111827")
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td bgcolor="${color}" style="border-radius:6px;background:${color};">
      <a href="${sanitizeHref(block.url)}" style="display:inline-block;padding:12px 28px;color:${textColor};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(block.label)}</a>
    </td></tr>
  </table>`
}

// A bare <hr> is exactly the kind of raw tag Outlook's Word rendering engine repaints with
// its own default margin/color regardless of inline style — email.ts never uses one anywhere
// else, always a table cell with a top border instead, so this matches that convention rather
// than introducing the one element in the whole file that would render inconsistently there.
function renderDivider(): string {
  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td style="border-top:1px solid #e4e4e7;font-size:0;line-height:0;">&nbsp;</td></tr></table>`
}

export function renderBlocksToHtml(blocks: EmailBlock[], branding?: EmailBlockBranding): string {
  return blocks.map(block => {
    switch (block.type) {
      case "text":    return renderText(block)
      case "image":   return renderImage(block)
      case "button":  return renderButton(block, branding)
      case "divider": return renderDivider()
    }
  }).join("")
}

// A block the form's own zod schema accepts as structurally valid (e.g. url: "" is a valid
// string) can still be functionally empty — an image with no file uploaded yet, a button with
// no label/url filled in. Nothing downstream catches that: renderImage() would happily emit
// `<img src="">` and renderButton() a button that links to "#". Used by template-modal.tsx to
// block save with a specific, per-block message instead of letting a half-filled block reach
// a real send silently. Returns the id of the first incomplete block, or null if all are fine.
export function findIncompleteBlock(blocks: EmailBlock[]): string | null {
  for (const block of blocks) {
    if (block.type === "text" && !block.html.replace(/<[^>]*>/g, "").trim()) return block.id
    if (block.type === "image" && !block.url.trim()) return block.id
    if (block.type === "button" && (!block.label.trim() || !block.url.trim())) return block.id
  }
  return null
}
