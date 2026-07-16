import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

// Sanitizing is left to the client (membre-email-log.tsx) rather than done here — isomorphic-
// dompurify falls back to jsdom in a Node/server context, and jsdom's dependency chain doesn't
// bundle cleanly under Next.js/Turbopack in an API route (ERR_REQUIRE_ESM). In the browser it
// uses the real DOM instead, which is also how rich-text-view.tsx already uses this same lib.
export const GET = withAdminAuth<{ id: string; emailId: string }>(async (_req, ctx, { id, emailId }) => {
  const { associationId } = ctx

  const email = await prisma.emailMessage.findFirst({
    where:  { id: emailId, membreId: id, associationId },
    select: { html: true },
  })
  if (!email) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  return NextResponse.json({ html: email.html })
})
