import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { rateLimit } from "@/lib/rate-limit"

// Public, no-login endpoint behind the unguessable token emailed by the churn-feedback-sweep
// cron (see src/app/api/cron/churn-feedback-sweep/route.ts) — same 160-bit-token model as
// /api/public/billet/[token] and /api/public/review/[token].
//
// GET is read-only (the usual convention for this app's public token routes). The reason
// itself is only ever written by PATCH, which the page (src/app/churn-feedback/[token]/
// page.tsx) calls from an explicit "Confirmer" click the visitor makes inside the rendered
// page — not from the page simply loading. That's deliberate: a corporate email gateway's
// link-scanner (even a sophisticated one that renders the page in a real headless browser to
// check for phishing/malware) typically only loads pages, it doesn't synthesize button
// clicks — so a scanner can see this page without ever recording a reason nobody chose. A
// reason can be re-confirmed later with a different value (last confirm wins, no lock) — if
// a visit ever did record something nobody meant, the real person's own click overrides it.

async function findByToken(token: string) {
  return prisma.churnFeedback.findUnique({
    where:  { token },
    select: { id: true, reason: true, detail: true, respondedAt: true },
  })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!(await rateLimit(`churn-feedback-info:${token}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const feedback = await findByToken(token)
  if (!feedback) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })

  return NextResponse.json({ reason: feedback.reason, detail: feedback.detail, respondedAt: feedback.respondedAt })
}

const patchSchema = z.object({
  // min(1) on both — an empty PATCH has no legitimate purpose and would silently blank out
  // whatever a previous visit already saved (same reasoning as the page's own submit guards).
  reason: z.string().min(1).max(40).optional(),
  detail: z.string().trim().min(1).max(2000).optional(),
}).refine(d => d.reason || d.detail, { message: "reason or detail required" })

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!(await rateLimit(`churn-feedback-update:${token}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const feedback = await findByToken(token)
  if (!feedback) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { reason, detail } = parsed.data

  await prisma.churnFeedback.update({
    where: { id: feedback.id },
    data: {
      ...(detail ? { detail } : {}),
      // Explicit reason (the "Confirmer" click) always overwrites — this is the one place
      // an update is expected and intentional. A detail-only PATCH (the "write in my own
      // words" path) still defaults to "outro" the first time, but never overrides a reason
      // that was already explicitly confirmed.
      ...(reason
        ? { reason, respondedAt: new Date() }
        : (detail && !feedback.reason ? { reason: "outro", respondedAt: feedback.respondedAt ?? new Date() } : {})),
    },
  })

  return NextResponse.json({ ok: true })
}
