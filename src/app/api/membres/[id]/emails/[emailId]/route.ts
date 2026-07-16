import { NextResponse } from "next/server"
import DOMPurify from "isomorphic-dompurify"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

// Strips navigation/interactivity at the source instead of relying on the preview
// iframe's CSS (pointer-events) to neutralize it — a CSS-only mitigation can be beaten
// by an inline `style="pointer-events:auto!important"` in the stored HTML, or silently
// never applied if malformed markup (e.g. an unclosed <textarea>) swallows the injected
// <style> tag as text. The iframe sandbox (no scripts/forms/top-navigation) is defense
// in depth on top of this, not a substitute for it.
function sanitizeEmailPreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "base"],
    FORBID_ATTR: ["href", "target", "action", "formaction", "http-equiv"],
  })
}

export const GET = withAdminAuth<{ id: string; emailId: string }>(async (_req, ctx, { id, emailId }) => {
  const { associationId } = ctx

  const email = await prisma.emailMessage.findFirst({
    where:  { id: emailId, membreId: id, associationId },
    select: { html: true },
  })
  if (!email) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  return NextResponse.json({ html: email.html ? sanitizeEmailPreviewHtml(email.html) : null })
})
