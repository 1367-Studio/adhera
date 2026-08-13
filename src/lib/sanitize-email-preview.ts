"use client"

// Strips navigation/interactivity from stored email HTML before it's rendered in a preview
// iframe — a CSS-only mitigation (pointer-events) can be beaten by an inline
// `style="pointer-events:auto!important"` in the stored HTML, or silently never applied if
// malformed markup (e.g. an unclosed <textarea>) swallows an appended <style> tag as text.
// Sandbox="" on the iframe is defense in depth on top of this, not a substitute for it.
//
// `dompurify` is imported dynamically (not at module top level) so this module never pulls
// jsdom into a server bundle: "use client" alone doesn't prevent that, since Next still
// evaluates client component modules once on the server for the initial HTML, and
// isomorphic-dompurify's eager server-side jsdom fallback crashes at that point
// (ERR_REQUIRE_ESM, via a transitive dependency of jsdom) — it did, for every caller of this
// function, until this was made lazy. Only ever call this from client components.
export async function sanitizeEmailPreviewHtml(html: string): Promise<string> {
  const { default: DOMPurify } = await import("dompurify")
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "base"],
    FORBID_ATTR: ["href", "target", "action", "formaction", "http-equiv"],
  })
}
