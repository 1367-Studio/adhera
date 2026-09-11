import { escapeHtml } from "@/lib/email"

// Some models wrap an answer in a ``` fence despite being told not to. One regex for every
// consumer (HTML answers, JSON extractions, plain-text drafts): the language tag is optional
// and arbitrary, and CRLF line ends are tolerated.
export function stripCodeFences(raw: string): string {
  const fenced = raw.trim().match(/^```[\w-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i)
  return (fenced ? fenced[1] : raw).trim()
}

// Normalises an AI answer that should be simple HTML: fences stripped, and bare text (a model
// that ignored the HTML instruction) wrapped in paragraphs — the result goes straight into
// the Tiptap editor or a sanitised preview (RichTextView).
export function normalizeAiHtml(raw: string): string {
  const text = stripCodeFences(raw)

  if (/<[a-z][\s\S]*>/i.test(text)) return text

  return text
    .split(/\n\s*\n/)
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, "<br>")}</p>`)
    .filter((paragraph) => paragraph !== "<p></p>")
    .join("")
}
