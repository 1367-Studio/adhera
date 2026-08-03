import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { guardModule } from "@/lib/auth/require-module"
import { sendEmailBatch } from "@/lib/mail"
import { sendSmsBatch } from "@/lib/sms"
import { customEmail } from "@/lib/email"
import { substituteVars, buildVars } from "@/lib/automation"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const EMAIL_CHUNK_SIZE = 100

const schema = z.object({
  cotisationIds: z.array(z.string()).min(1).max(500),
  channel:       z.enum(["EMAIL", "SMS"]),
  subject:       z.string().max(200).optional(),
  body:          z.string().min(1),
})

type ReminderResult = { cotisationId: string; membreId: string; status: "SENT" | "FAILED" }

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const messagesGuard = await guardModule(associationId, "messages")
  if (messagesGuard) return messagesGuard

  const raw    = await req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { cotisationIds, channel, subject, body } = parsed.data

  if (channel === "SMS") {
    const smsGuard = await guardModule(associationId, "sms")
    if (smsGuard) return smsGuard
  }
  if (channel === "EMAIL" && !subject?.trim()) {
    return NextResponse.json({ error: "Objet requis pour un envoi par email" }, { status: 422 })
  }

  const [assoc, cotisations] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: associationId },
      select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
    }),
    // Scoped to this association and EN_ATTENTE — defense in depth, doesn't just trust
    // that the client only ever sends ids that were actually selectable in the UI.
    prisma.cotisation.findMany({
      where:   { id: { in: cotisationIds }, associationId, status: "EN_ATTENTE" },
      include: { membre: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
    }),
  ])
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  // Ids the client asked for that this query didn't return at all — no longer EN_ATTENTE
  // (paid/exempted since the row was selected), deleted, or from another association.
  // Surfaced distinctly from skippedNoContact instead of silently vanishing from every
  // count, which would otherwise leave sent+failed+skippedNoContact undercounting the
  // original selection with no explanation.
  const skippedInvalid = cotisationIds.length - cotisations.length

  const eligible = cotisations.filter(c => channel === "EMAIL" ? !!c.membre.email : !!c.membre.phone)
  const skippedNoContact = cotisations.length - eligible.length

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, skippedNoContact, skippedInvalid, results: [] as ReminderResult[] })
  }

  const results: ReminderResult[] = []

  if (channel === "EMAIL") {
    const branding = resolveDocumentBranding(assoc)
    const payloads = eligible.map(c => {
      const vars = buildVars({
        prenom: c.membre.firstName, nom: c.membre.lastName, email: c.membre.email ?? "",
        association: assoc.name, slug: assoc.slug,
        anneeCotisation: c.year, montantCotisation: c.amount.toString(),
      })
      return {
        ...customEmail({
          associationName: assoc.name,
          subject:         substituteVars(subject!, vars),
          bodyHtml:        substituteVars(body, vars),
          recipientEmail:  c.membre.email!,
          branding,
        }),
        context: { associationId, membreId: c.membre.id, source: "COTISATION_REMINDER", sourceId: c.id },
      }
    })

    // sendEmailBatch (not sendEmailBulk) — its result array stays in input order with one
    // entry per payload, so two selected cotisations belonging to the same member (same
    // email, different year/amount) don't collide the way summing sendEmailBulk's
    // aggregate `failedRecipients` by address would.
    for (let i = 0; i < payloads.length; i += EMAIL_CHUNK_SIZE) {
      const chunk   = payloads.slice(i, i + EMAIL_CHUNK_SIZE)
      const cotChunk = eligible.slice(i, i + EMAIL_CHUNK_SIZE)
      const chunkResults = await sendEmailBatch(chunk)
      chunkResults.forEach((r, j) => {
        results.push({ cotisationId: cotChunk[j].id, membreId: cotChunk[j].membre.id, status: r.ok ? "SENT" : "FAILED" })
      })
    }
  } else {
    const jobs = eligible.map(c => {
      const vars = buildVars({
        prenom: c.membre.firstName, nom: c.membre.lastName, email: c.membre.email ?? "",
        association: assoc.name, slug: assoc.slug,
        anneeCotisation: c.year, montantCotisation: c.amount.toString(),
      })
      return { to: c.membre.phone!, body: substituteVars(body, vars) }
    })
    const outcomes = await sendSmsBatch(jobs, associationId)
    eligible.forEach((c, i) => {
      results.push({ cotisationId: c.id, membreId: c.membre.id, status: outcomes[i] ? "SENT" : "FAILED" })
    })
  }

  const sent   = results.filter(r => r.status === "SENT").length
  const failed = results.length - sent

  const cotisationById = new Map(cotisations.map(c => [c.id, c]))
  // One entry per cotisation — this is what makes it show up on the member's own ficha
  // (Historique tab already matches on entity: "Cotisation", entityId: <this id>, see
  // src/app/api/membres/[id]/logs/route.ts).
  await Promise.all(results.map(r => {
    const c = cotisationById.get(r.cotisationId)
    return writeActivityLog({
      associationId,
      actorId:  userId,
      action:   "COTISATION_REMINDER_SENT",
      entity:   "Cotisation",
      entityId: r.cotisationId,
      label:    c ? `${c.membre.firstName} ${c.membre.lastName} — ${c.year}` : undefined,
      metadata: { channel, status: r.status },
    })
  }))

  return NextResponse.json({ sent, failed, skippedNoContact, skippedInvalid, results })
}, { roles: MANAGERS, module: "cotisations" })
