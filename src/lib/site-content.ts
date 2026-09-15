// If it's already HTML (from RichTextEditor), pass it through. Otherwise convert plain-text
// line breaks to <br> so values saved before the site builder used a rich text editor still
// render correctly.
export function toHtml(content: string): string {
  if (!content) return ""
  if (content.trimStart().startsWith("<")) return content
  return content.replace(/\n/g, "<br>")
}

// Shared between manually-added sections (site-controls-panel.tsx) and AI-generated drafts
// (site-ai-assistant.tsx) — a section's id only needs to be unique within its own siteConfig,
// never persisted/looked-up outside it, so a short random string is enough.
export function newSectionId(): string {
  return Math.random().toString(36).slice(2, 10)
}
