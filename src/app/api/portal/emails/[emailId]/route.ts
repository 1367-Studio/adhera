import { NextResponse } from "next/server"
import { withPortalAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

// Sanitizing is left to the client (communications/page.tsx) rather than done here — see
// sanitize-email-preview.ts for why.
export const GET = withPortalAuth<{ emailId: string }>(async (_req, ctx, { emailId }) => {
  // Scoped to the caller's own membreId, same as emails/route.ts — a member can only ever
  // fetch the content of their own emails, never one addressed to someone else.
  const email = await prisma.emailMessage.findFirst({
    where:  { id: emailId, membreId: ctx.membreId!, associationId: ctx.associationId },
    select: { html: true },
  })
  if (!email) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  return NextResponse.json({ html: email.html })
})
