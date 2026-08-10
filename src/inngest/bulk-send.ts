import { inngest } from "@/lib/inngest"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmailBulk, sendEmailBatch } from "@/lib/mail"
import { sendSmsBatch } from "@/lib/sms"
import { customEmail, sondageInvitationEmail, type EmailBranding } from "@/lib/email"
import { substituteVars, buildVars } from "@/lib/automation"
import { writeActivityLog } from "@/lib/activity-log"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"

const EMAIL_CHUNK_SIZE = 100

function notifyBulkSendCompleted(associationId: string, payload: Record<string, unknown>) {
  return pusherServer.trigger(`private-association-${associationId}`, "bulk-send-completed", payload).catch(() => {})
}

// Only members with an activated portal account (Membre.userId set) can receive an
// in-app bell notification — others still get the actual email itself, just no bell entry.
//
// Grouped under one groupKey per association (like notifyAdminsOfResponse's sondage grouping)
// so a member who doesn't check the bell for a while gets one row that accumulates
// ("3 nouveaux messages" / last subject) instead of one unread row per newsletter piling up
// forever — the exact bell-flooding scenario that pattern was built to avoid.
async function notifyMembersOfMessage(associationId: string, memberIds: string[], subject: string, link: string) {
  if (!memberIds.length) return
  const recipients = await prisma.membre.findMany({
    where:  { id: { in: memberIds }, userId: { not: null } },
    select: { userId: true },
  })
  if (!recipients.length) return

  const groupKey = `bulk-message:${associationId}`

  await Promise.all(recipients.map(async (r) => {
    const userId   = r.userId!
    const existing = await prisma.notification.findFirst({
      where:  { userId, groupKey, read: false },
      select: { id: true, count: true },
    })
    if (existing) {
      const count = existing.count + 1
      await prisma.notification.update({
        where: { id: existing.id },
        data: {
          count,
          title:     `${count} nouveaux messages`,
          body:      `Dernier : ${subject}`,
          createdAt: new Date(),
        },
      })
    } else {
      await prisma.notification.create({
        data: { userId, groupKey, count: 1, title: "Nouveau message", body: subject, link, scope: "MEMBRE" },
      })
    }
  }))
  await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
}

// ── Bulk member email (src/app/api/membres/email/route.ts) ────────────────────

type MembresEmailMember = { id: string; firstName: string; lastName: string; email: string }

export const bulkSendMembresEmail = inngest.createFunction(
  { id: "bulk-send-membres-email", triggers: { event: "bulk/membres-email.requested" } },
  async ({ event, step }) => {
    const { jobId, associationId, actorId, subject, bodyHtml, branding, associationName, slug, members, externalEmails, activityMeta } = event.data as {
      jobId: string; associationId: string; actorId: string
      subject: string; bodyHtml: string; branding: EmailBranding; associationName: string; slug: string
      members: MembresEmailMember[]; externalEmails: string[]
      activityMeta: { recipientMode: string; typeId?: string; recipientCount?: number; externalEmailCount?: number; externalEmails?: string[] }
    }

    const { sent, failed, failedNames, deliveredMemberIds } = await step.run("send", async () => {
      const memberPayloads = members.map(m => {
        const vars = buildVars({ prenom: m.firstName, nom: m.lastName, email: m.email, association: associationName, slug })
        return {
          ...customEmail({ associationName, subject: substituteVars(subject, vars), bodyHtml: substituteVars(bodyHtml, vars), recipientEmail: m.email, branding }),
          context: { associationId, membreId: m.id, source: "BULK_MESSAGE" },
        }
      })
      const externalPayloads = externalEmails.map(email => {
        const vars = buildVars({ prenom: "", nom: "", email, association: associationName, slug })
        return {
          ...customEmail({ associationName, subject: substituteVars(subject, vars), bodyHtml: substituteVars(bodyHtml, vars), recipientEmail: email, branding }),
          context: { associationId, source: "BULK_MESSAGE" },
        }
      })

      const result = await sendEmailBulk([...memberPayloads, ...externalPayloads])
      const failedEmails = new Set(result.failedRecipients)
      const failedNames = [
        ...members.filter(m => failedEmails.has(m.email)).map(m => `${m.firstName} ${m.lastName}`),
        ...externalEmails.filter(email => failedEmails.has(email)),
      ]
      const deliveredMemberIds = members.filter(m => !failedEmails.has(m.email)).map(m => m.id)
      return { sent: result.sent, failed: result.failed, failedNames, deliveredMemberIds }
    })

    await step.run("log-activity", () => writeActivityLog({
      associationId,
      actorId,
      action:   "EMAIL_SENT_BULK",
      entity:   "Membre",
      label:    subject,
      metadata: { sent, failed, ...activityMeta },
    }))

    await step.run("notify-members", () => notifyMembersOfMessage(
      associationId, deliveredMemberIds, subject, `/portal/${slug}/communications`,
    ))

    await step.run("notify", () => notifyBulkSendCompleted(associationId, {
      jobId, kind: "membres-email", sent, failed, failedNames: failedNames.slice(0, 5),
    }))

    return { sent, failed }
  },
)

// ── Bulk member SMS (src/app/api/membres/sms/route.ts) ────────────────────────

type MembresSmsMember = { id: string; firstName: string; lastName: string; phone: string }

export const bulkSendMembresSms = inngest.createFunction(
  { id: "bulk-send-membres-sms", triggers: { event: "bulk/membres-sms.requested" } },
  async ({ event, step }) => {
    const { jobId, associationId, actorId, body, associationName, slug, members, activityMeta } = event.data as {
      jobId: string; associationId: string; actorId: string
      body: string; associationName: string; slug: string
      members: MembresSmsMember[]
      activityMeta: { recipientMode: string; typeId?: string; recipientCount?: number }
    }

    const { sent, failed, failedNames } = await step.run("send", async () => {
      const jobs = members.map(m => {
        const vars = buildVars({ prenom: m.firstName, nom: m.lastName, email: "", association: associationName, slug })
        return { to: m.phone, body: substituteVars(body, vars), membreId: m.id }
      })
      const results = await sendSmsBatch(jobs, associationId, { source: "BULK_MESSAGE" })
      const sent   = results.filter(r => r.ok).length
      const failedNames = members
        .map((m, i) => ({ name: `${m.firstName} ${m.lastName}`, ...results[i] }))
        .filter(r => !r.ok)
        .map(r => r.reason ? `${r.name} (${r.reason})` : r.name)
      return { sent, failed: results.length - sent, failedNames }
    })

    // No in-app bell notification here (unlike the email variant below): the member portal
    // has no SMS history view at all (only /api/portal/emails backs the communications page),
    // so a notification link would dead-end — the SMS itself is already the full message,
    // delivered directly to their phone.
    if (sent > 0) {
      await step.run("log-activity", () => writeActivityLog({
        associationId,
        actorId,
        action:   "SMS_SENT_BULK",
        entity:   "Membre",
        label:    body.slice(0, 80),
        metadata: { sent, failed, ...activityMeta },
      }))
    }

    await step.run("notify", () => notifyBulkSendCompleted(associationId, {
      jobId, kind: "membres-sms", sent, failed, failedNames: failedNames.slice(0, 5),
    }))

    return { sent, failed }
  },
)

// ── Cotisation payment reminders (src/app/api/cotisations/reminders/route.ts) ─

type ReminderTarget = { cotisationId: string; membreId: string; firstName: string; lastName: string; email: string | null; phone: string | null; year: number; montantCotisation: string }
type ReminderResult = { cotisationId: string; membreId: string; status: "SENT" | "FAILED" }

export const bulkSendCotisationReminders = inngest.createFunction(
  { id: "bulk-send-cotisation-reminders", triggers: { event: "bulk/cotisation-reminders.requested" } },
  async ({ event, step }) => {
    const { jobId, associationId, actorId, channel, subject, body, associationName, slug, branding, targets } = event.data as {
      jobId: string; associationId: string; actorId: string
      channel: "EMAIL" | "SMS"; subject?: string; body: string
      associationName: string; slug: string; branding: EmailBranding
      targets: ReminderTarget[]
    }

    const results = await step.run("send", async () => {
      const results: ReminderResult[] = []

      if (channel === "EMAIL") {
        const payloads = targets.map(target => {
          const vars = buildVars({
            prenom: target.firstName, nom: target.lastName, email: target.email ?? "",
            association: associationName, slug, anneeCotisation: target.year, montantCotisation: target.montantCotisation,
          })
          return {
            ...customEmail({ associationName, subject: substituteVars(subject!, vars), bodyHtml: substituteVars(body, vars), recipientEmail: target.email!, branding }),
            context: { associationId, membreId: target.membreId, source: "COTISATION_REMINDER", sourceId: target.cotisationId },
          }
        })
        for (let i = 0; i < payloads.length; i += EMAIL_CHUNK_SIZE) {
          const chunk       = payloads.slice(i, i + EMAIL_CHUNK_SIZE)
          const chunkTargets = targets.slice(i, i + EMAIL_CHUNK_SIZE)
          const chunkResults = await sendEmailBatch(chunk)
          chunkResults.forEach((r, j) => {
            results.push({ cotisationId: chunkTargets[j].cotisationId, membreId: chunkTargets[j].membreId, status: r.ok ? "SENT" : "FAILED" })
          })
        }
      } else {
        const jobs = targets.map(target => {
          const vars = buildVars({
            prenom: target.firstName, nom: target.lastName, email: target.email ?? "",
            association: associationName, slug, anneeCotisation: target.year, montantCotisation: target.montantCotisation,
          })
          return { to: target.phone!, body: substituteVars(body, vars), membreId: target.membreId }
        })
        const outcomes = await sendSmsBatch(jobs, associationId, { source: "COTISATION_REMINDER" })
        targets.forEach((target, i) => {
          results.push({ cotisationId: target.cotisationId, membreId: target.membreId, status: outcomes[i].ok ? "SENT" : "FAILED" })
        })
      }

      return results
    })

    const sentIds = results.filter(r => r.status === "SENT").map(r => r.cotisationId)
    const sent    = sentIds.length
    const failed  = results.length - sent

    if (sentIds.length > 0) {
      await step.run("mark-reminded", () => prisma.cotisation.updateMany({ where: { id: { in: sentIds } }, data: { lastReminderSentAt: new Date() } }))
    }

    const targetById = new Map(targets.map(t => [t.cotisationId, t]))
    await step.run("log-activity", () => Promise.all(results.map(r => {
      const target = targetById.get(r.cotisationId)
      return writeActivityLog({
        associationId,
        actorId,
        action:   "COTISATION_REMINDER_SENT",
        entity:   "Cotisation",
        entityId: r.cotisationId,
        label:    target ? `${target.firstName} ${target.lastName} — ${target.year}` : undefined,
        metadata: { channel, status: r.status },
      })
    })))

    await step.run("notify", () => notifyBulkSendCompleted(associationId, {
      jobId, kind: "cotisation-reminders", sent, failed,
    }))

    return { sent, failed }
  },
)

// ── Sondage invitations (src/lib/sondage-invitations.ts) ──────────────────────

type SondageInviteMember = { id: string; firstName: string; email: string }

export const bulkSendSondageInvitations = inngest.createFunction(
  { id: "bulk-send-sondage-invitations", triggers: { event: "bulk/sondage-invitations.requested" } },
  async ({ event, step }) => {
    const { jobId, associationId, sondageId, associationName, slug, branding, sondageTitle, deadline, members } = event.data as {
      jobId: string; associationId: string; sondageId: string
      associationName: string; slug: string; branding: EmailBranding
      sondageTitle: string; deadline: string | null
      members: SondageInviteMember[]
    }

    const { emailsSent, emailsFailed } = await step.run("send", async () => {
      const portalUrl = `${APP_URL}/portal/${slug}/sondages/${sondageId}`
      const { sent, failed } = await sendEmailBulk(members.map(m => {
        const mail = sondageInvitationEmail({
          firstName:       m.firstName,
          email:           m.email,
          associationName,
          sondageTitle,
          deadline:        deadline ? new Date(deadline) : null,
          portalUrl,
          branding,
        })
        return { ...mail, context: { associationId, membreId: m.id, source: "SONDAGE", sourceId: sondageId } }
      }))
      return { emailsSent: sent, emailsFailed: failed }
    })

    await step.run("notify", () => notifyBulkSendCompleted(associationId, {
      jobId, kind: "sondage-invitations", emailsSent, emailsFailed,
    }))

    return { emailsSent, emailsFailed }
  },
)
