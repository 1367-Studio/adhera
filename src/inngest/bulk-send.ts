import { inngest } from "@/lib/inngest"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmailBulk, sendEmailBatch, sendEmailsWithAttachments } from "@/lib/mail"
import { sendSmsBatch } from "@/lib/sms"
import { customEmail, sondageInvitationEmail, type EmailBranding } from "@/lib/email"
import { substituteVars, buildVars } from "@/lib/automation"
import { writeActivityLog } from "@/lib/activity-log"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import type { VerifiedEmailAttachment } from "@/lib/email-attachments"

const EMAIL_CHUNK_SIZE = 100

// Recipients per step when attachments force one Resend request per recipient (see
// sendEmailsWithAttachments in src/lib/mail.ts): at ≥0.7 s apiece that's roughly 30–60 s per
// step, retries included — comfortably inside a serverless function's timeout, where the
// full 600-recipient maximum in a single step (7+ minutes) would not be. Also bounds how much
// an Inngest retry of one failed step has to replay (idempotently) to 40 sends.
const ATTACHMENT_SEND_CHUNK_SIZE = 40

export function notifyBulkSendCompleted(associationId: string, payload: Record<string, unknown>) {
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
type MembresEmailRecipient = { member: MembresEmailMember; externalEmail?: never } | { externalEmail: string; member?: never }
type MembresEmailSendOutcome = { sent: number; failed: number; failedNames: string[]; deliveredMemberIds: string[] }

export const bulkSendMembresEmail = inngest.createFunction(
  { id: "bulk-send-membres-email", triggers: { event: "bulk/membres-email.requested" } },
  async ({ event, step }) => {
    const { jobId, associationId, actorId, subject, bodyHtml, branding, associationName, slug, members, externalEmails, attachments = [], activityMeta } = event.data as {
      jobId: string; associationId: string; actorId: string
      subject: string; bodyHtml: string; branding: EmailBranding; associationName: string; slug: string
      members: MembresEmailMember[]; externalEmails: string[]
      // Set by src/app/api/membres/email/route.ts only once every file was verified in R2 —
      // metadata only (Resend fetches each file from its URL), absent when there are none.
      attachments?: VerifiedEmailAttachment[]
      activityMeta: {
        recipientMode: string; typeId?: string; recipientCount?: number; externalEmailCount?: number; externalEmails?: string[]
        attachmentCount?: number; attachmentNames?: string[]
      }
    }

    // Only ever called inside a step: Inngest re-runs this function body once per step, so
    // rendering every recipient's email up here would be repeated on each of those re-runs.
    const buildMemberPayload = (member: MembresEmailMember) => {
      const vars = buildVars({ prenom: member.firstName, nom: member.lastName, email: member.email, association: associationName, slug })
      return {
        ...customEmail({ associationName, subject: substituteVars(subject, vars), bodyHtml: substituteVars(bodyHtml, vars), recipientEmail: member.email, branding }),
        context: { associationId, membreId: member.id, source: "BULK_MESSAGE" },
      }
    }
    const buildExternalPayload = (email: string) => {
      const vars = buildVars({ prenom: "", nom: "", email, association: associationName, slug })
      return {
        ...customEmail({ associationName, subject: substituteVars(subject, vars), bodyHtml: substituteVars(bodyHtml, vars), recipientEmail: email, branding }),
        context: { associationId, source: "BULK_MESSAGE" },
      }
    }

    let outcome: MembresEmailSendOutcome
    if (!attachments.length) {
      outcome = await step.run("send", async () => {
        const result = await sendEmailBulk([...members.map(buildMemberPayload), ...externalEmails.map(buildExternalPayload)])
        const failedEmails = new Set(result.failedRecipients)
        const failedNames = [
          ...members.filter(m => failedEmails.has(m.email)).map(m => `${m.firstName} ${m.lastName}`),
          ...externalEmails.filter(email => failedEmails.has(email)),
        ]
        const deliveredMemberIds = members.filter(m => !failedEmails.has(m.email)).map(m => m.id)
        return { sent: result.sent, failed: result.failed, failedNames, deliveredMemberIds }
      })
    } else {
      // Members first, then external addresses — the same order (and so the same failedNames
      // order) as the single-step path above. Chunks run one after another, never in
      // parallel: sendEmailsWithAttachments paces its requests under Resend's rate limit, and
      // concurrent chunks would multiply that rate.
      const recipients: MembresEmailRecipient[] = [
        ...members.map(member => ({ member })),
        ...externalEmails.map(externalEmail => ({ externalEmail })),
      ]
      const chunkCount = Math.ceil(recipients.length / ATTACHMENT_SEND_CHUNK_SIZE)
      const chunkOutcomes: MembresEmailSendOutcome[] = []

      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const chunkRecipients = recipients.slice(chunkIndex * ATTACHMENT_SEND_CHUNK_SIZE, (chunkIndex + 1) * ATTACHMENT_SEND_CHUNK_SIZE)
        chunkOutcomes.push(await step.run(`send-attachments-${chunkIndex}`, async () => {
          const payloads = chunkRecipients.map(recipient =>
            recipient.member ? buildMemberPayload(recipient.member) : buildExternalPayload(recipient.externalEmail))
          const results = await sendEmailsWithAttachments(payloads, attachments, { idempotencyKeyPrefix: jobId })

          // Results come back in payload order, so each one maps straight to its recipient —
          // no matching by address needed.
          const chunkOutcome: MembresEmailSendOutcome = { sent: 0, failed: 0, failedNames: [], deliveredMemberIds: [] }
          chunkRecipients.forEach((recipient, index) => {
            if (results[index]?.ok) {
              chunkOutcome.sent++
              if (recipient.member) chunkOutcome.deliveredMemberIds.push(recipient.member.id)
            } else {
              chunkOutcome.failed++
              chunkOutcome.failedNames.push(recipient.member ? `${recipient.member.firstName} ${recipient.member.lastName}` : recipient.externalEmail)
            }
          })
          return chunkOutcome
        }))
      }

      outcome = {
        sent:               chunkOutcomes.reduce((total, chunkOutcome) => total + chunkOutcome.sent, 0),
        failed:             chunkOutcomes.reduce((total, chunkOutcome) => total + chunkOutcome.failed, 0),
        failedNames:        chunkOutcomes.flatMap(chunkOutcome => chunkOutcome.failedNames),
        deliveredMemberIds: chunkOutcomes.flatMap(chunkOutcome => chunkOutcome.deliveredMemberIds),
      }
    }
    const { sent, failed, failedNames, deliveredMemberIds } = outcome

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
