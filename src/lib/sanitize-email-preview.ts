"use client"

import DOMPurify from "isomorphic-dompurify"

// Strips navigation/interactivity from stored email HTML before it's rendered in a preview
// iframe — a CSS-only mitigation (pointer-events) can be beaten by an inline
// `style="pointer-events:auto!important"` in the stored HTML, or silently never applied if
// malformed markup (e.g. an unclosed <textarea>) swallows an appended <style> tag as text.
// Sandbox="" on the iframe is defense in depth on top of this, not a substitute for it.
//
// Client-only ("use client" + isomorphic-dompurify): the isomorphic-dompurify server fallback
// pulls in jsdom, which doesn't bundle cleanly under Next.js/Turbopack in a server context
// (ERR_REQUIRE_ESM). Only ever call this from client components.
export function sanitizeEmailPreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "base"],
    FORBID_ATTR: ["href", "target", "action", "formaction", "http-equiv"],
  })
}
