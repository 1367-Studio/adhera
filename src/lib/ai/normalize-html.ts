import { escapeHtml } from "@/lib/email"

// Some models wrap an answer in a ``` fence despite being told not to. One regex for every
// consumer (HTML answers, JSON extractions, plain-text drafts): the language tag is optional
// and arbitrary, and CRLF line ends are tolerated.
export function stripCodeFences(raw: string): string {
  const fenced = raw.trim().match(/^```[\w-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i)
  return (fenced ? fenced[1] : raw).trim()
}

// Whitespace touching a block tag (with its attributes). Inline tags (<strong>, <em>, <a>…)
// are left alone: the space in "<strong>Date :</strong> 15 avril" is real content.
const WHITESPACE_AROUND_BLOCK_TAG = /\s*(<\/?(?:p|h[1-6]|ul|ol|li|blockquote|hr|br)\b[^>]*>)\s*/gi

// Normalises an AI answer that should be simple HTML: fences stripped, and bare text (a model
// that ignored the HTML instruction) wrapped in paragraphs — the result goes straight into
// the Tiptap editor or a sanitised preview (RichTextView).
export function normalizeAiHtml(raw: string): string {
  const text = stripCodeFences(raw)

  // Models answer with pretty-printed HTML (newlines + indentation between tags). Tiptap's
  // insertContent parses with preserveWhitespace: "full", so each of those gaps became an
  // empty paragraph — or an empty bullet inside a list.
  if (/<[a-z][\s\S]*>/i.test(text)) return text.replace(WHITESPACE_AROUND_BLOCK_TAG, "$1")

  return text
    .split(/\n\s*\n/)
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, "<br>")}</p>`)
    .filter((paragraph) => paragraph !== "<p></p>")
    .join("")
}
