import { randomBytes } from "crypto"
import { inngest } from "@/lib/inngest"
import { prisma } from "@/lib/prisma/client"
import { sendEmailBatch } from "@/lib/mail"
import { eventReviewRequestEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { APP_URL } from "@/lib/env"

// Sends a "leave a review" email one day after an event's date, to every participant who
// was marked present and has an email on file. Fixed one-day delay for now — unlike
// EVENT_REMINDER this isn't wired into the per-association AutomationRule engine (no admin
// configuration needed to get it working). reviewRequestedAt dedupes so a participant is
// only ever emailed once, even though this cron re-scans the same day window daily.
export const eventReviewRequest = inngest.createFunction(
  { id: "event-review-request", triggers: { cron: "0 10 * * *" } },
  async ({ step }) => {
    const sent = await step.run("send-review-requests", async () => {
      const now       = new Date()
      const target     = new Date(now.getTime() - 86_400_000)
      const dayStart   = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 0, 0, 0)
      const dayEnd     = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59, 59)

      const events = await prisma.evenement.findMany({
        where: { date: { gte: dayStart, lte: dayEnd } },
        include: {
          association: { select: { id: true, name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
          participations: {
            where: { present: true, email: { not: null }, avis: null, reviewRequestedAt: null },
          },
        },
      })

      let count = 0
      for (const event of events) {
        const targets = event.participations
        if (!targets.length) continue

        const jobs = targets.map(p => {
          const reviewToken = p.reviewToken ?? randomBytes(20).toString("hex")
          const reviewUrl   = `${APP_URL}/avis/${reviewToken}`
          const { subject, html } = eventReviewRequestEmail({
            firstName:       p.firstName,
            email:           p.email!,
            associationName: event.association.name,
            eventTitle:      event.title,
            eventDate:       event.date,
            reviewUrl,
            branding:        resolveDocumentBranding(event.association),
          })
          return {
            participationId: p.id,
            reviewToken,
            payload: {
              to: p.email!, subject, html,
              context: { associationId: event.associationId, membreId: p.membreId ?? undefined, source: "EVENT_REVIEW_REQUEST", sourceId: p.id },
            },
          }
        })

        const results = await sendEmailBatch(jobs.map(j => j.payload))
        const succeeded = jobs.filter((_, idx) => results[idx].ok)

        await Promise.all(succeeded.map(j =>
          prisma.participation.update({
            where: { id: j.participationId },
            data:  { reviewToken: j.reviewToken, reviewRequestedAt: new Date() },
          })
        ))

        count += succeeded.length
      }

      return count
    })

    return { sent }
  },
)
