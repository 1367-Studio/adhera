import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { sendEmailBatch } from "@/lib/mail"
import { sendSmsBatch } from "@/lib/sms"
import { eventReminderEmail } from "@/lib/email"
import { substituteVars, buildVars, parseRecipients, computeNextRunAt } from "@/lib/automation"
import { parseModules } from "@/lib/modules"
import type { TriggerType, MessageChannel } from "@prisma/client"

const BATCH_SIZE = 100

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const now = new Date()
  let totalSent = 0

  const rules = await prisma.automationRule.findMany({
    where: {
      status:      "ACTIVE",
      nextRunAt:   { lte: now },
      triggerType: { notIn: ["RSVP_CONFIRMED", "MEMBER_CREATED"] },
    },
    include: {
      template:    true,
      association: { select: { id: true, name: true, slug: true, modules: true } },
    },
  })

  for (const rule of rules) {
    try {
      const sent = await processRule(rule, now)
      totalSent += sent
    } catch (err) {
      console.error(`[cron] Rule ${rule.id} failed:`, err)
    }
  }

  return NextResponse.json({ ok: true, processed: rules.length, totalSent })
}

type RuleWithRelations = Awaited<ReturnType<typeof prisma.automationRule.findMany<{
  include: { template: true; association: { select: { id: true; name: true; slug: true; modules: true } } }
}>>>[number]

async function processRule(rule: RuleWithRelations, now: Date): Promise<number> {
  const mods = parseModules(rule.association.modules)
  if (!mods.messages) {
    await updateRuleNextRun(rule.id, rule.triggerType as TriggerType, rule.triggerConfig as Record<string, unknown>, now)
    return 0
  }

  const channel     = rule.channel as MessageChannel
  const smsEnabled  = mods.sms && (channel === "SMS" || channel === "BOTH")
  const emailEnabled = channel === "EMAIL" || channel === "BOTH"

  const { mode, typeId } = parseRecipients(rule.recipients)
  const triggerType = rule.triggerType as TriggerType
  const config = rule.triggerConfig as Record<string, unknown>

  if (triggerType === "EVENT_REMINDER") {
    const sent = await processEventReminder(rule, config, now, { emailEnabled, smsEnabled })
    await updateRuleNextRun(rule.id, triggerType, config, now)
    return sent
  }

  const cooldownDays   = (config.cooldownDays as number | undefined) ?? 7
  const cooldownCutoff = new Date(now.getTime() - cooldownDays * 86_400_000)

  let membres = await prisma.membre.findMany({
    where: {
      associationId: rule.associationId,
      status:        "ACTIF",
      deletedAt:     null,
      ...(mode === "TYPE" && typeId ? { typeId } : {}),
    },
    include: {
      cotisations: {
        where:   { status: "EN_ATTENTE" },
        orderBy: { year: "desc" },
        take:    1,
      },
    },
  })

  if (triggerType === "EVENT_COTISATION_DUE") {
    const dueDate    = config.dueDate ? new Date(config.dueDate as string) : endOfYear(now)
    const daysBefore = (config.daysBefore as number) ?? 30
    const alertStart = new Date(dueDate.getTime() - daysBefore * 86_400_000)
    if (now < alertStart || now > dueDate) {
      return updateRuleNextRun(rule.id, triggerType, config, now)
    }
    const year = (config.year as number) ?? now.getFullYear()
    membres = membres.filter(m => m.cotisations.some(c => c.year === year))
  }

  if (triggerType === "EVENT_PAYMENT_OVERDUE") {
    const year      = (config.year as number) ?? now.getFullYear()
    const daysAfter = (config.daysAfter as number) ?? 30
    const refDate   = new Date(`${year}-01-01`)
    const alertDate = new Date(refDate.getTime() + daysAfter * 86_400_000)
    if (now < alertDate) {
      return updateRuleNextRun(rule.id, triggerType, config, now)
    }
    membres = membres.filter(m => m.cotisations.some(c => c.year === year))
  }

  let targets = membres
  if (triggerType === "EVENT_COTISATION_DUE" || triggerType === "EVENT_PAYMENT_OVERDUE") {
    const recentLogs = await prisma.automationLog.findMany({
      where:  { ruleId: rule.id, sentAt: { gte: cooldownCutoff }, membreId: { in: membres.map(m => m.id) } },
      select: { membreId: true },
    })
    const notifiedIds = new Set(recentLogs.map(l => l.membreId))
    targets = membres.filter(m => !notifiedIds.has(m.id))
  }

  const jobs = targets.map(membre => {
    const cotisation = membre.cotisations[0]
    const vars = buildVars({
      prenom:            membre.firstName,
      nom:               membre.lastName,
      email:             membre.email ?? "",
      association:       rule.association.name,
      slug:              rule.association.slug,
      anneeCotisation:   cotisation?.year,
      montantCotisation: cotisation ? cotisation.amount.toString() : undefined,
    })
    return { membreId: membre.id, membre, vars }
  })

  let sent = 0

  // Email dispatch
  if (emailEnabled) {
    const emailJobs = jobs
      .filter(j => j.membre.email)
      .map(j => ({
        membreId: j.membreId,
        payload: {
          to:      j.membre.email!,
          subject: substituteVars(rule.template.subject, j.vars),
          html:    substituteVars(rule.template.body, j.vars),
        },
      }))

    for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
      const chunk = emailJobs.slice(i, i + BATCH_SIZE)
      const ok    = await sendEmailBatch(chunk.map(j => j.payload))
      if (ok) {
        await prisma.automationLog.createMany({
          data: chunk.map(j => ({ ruleId: rule.id, membreId: j.membreId, subject: j.payload.subject })),
        })
        sent += chunk.length
      }
    }
  }

  // SMS dispatch
  if (smsEnabled && rule.template.smsBody) {
    const smsJobs = jobs
      .filter(j => j.membre.phone)
      .map(j => ({
        membreId: j.membreId,
        to:       j.membre.phone!,
        body:     substituteVars(rule.template.smsBody!, j.vars),
      }))

    for (let i = 0; i < smsJobs.length; i += BATCH_SIZE) {
      const chunk   = smsJobs.slice(i, i + BATCH_SIZE)
      const results = await sendSmsBatch(chunk.map(j => ({ to: j.to, body: j.body })))
      const succeeded = chunk.filter((_, idx) => results[idx])
      if (succeeded.length > 0) {
        await prisma.automationLog.createMany({
          data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId })),
        })
        sent += succeeded.length
      }
    }
  }

  const isOnce    = triggerType === "SCHEDULED_ONCE"
  const nextRunAt = isOnce ? null : computeNextRunAt(triggerType, config)
  await prisma.automationRule.update({
    where: { id: rule.id },
    data:  { lastRunAt: now, nextRunAt, status: isOnce ? "DONE" : "ACTIVE" },
  })

  return sent
}

// ── EVENT_REMINDER processor ─────────────────────────────────────────────────

async function processEventReminder(
  rule: RuleWithRelations,
  config: Record<string, unknown>,
  now: Date,
  opts: { emailEnabled: boolean; smsEnabled: boolean },
): Promise<number> {
  const daysBefore = (config.daysBefore as number) ?? 1
  const target     = new Date(now.getTime() + daysBefore * 86_400_000)
  const dayStart   = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 0, 0, 0)
  const dayEnd     = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59, 59)

  const events = await prisma.evenement.findMany({
    where: { associationId: rule.associationId, date: { gte: dayStart, lte: dayEnd } },
    include: {
      participations: {
        where:   { rsvp: { in: ["CONFIRME", "PROVAVEL"] } },
        include: { membre: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
      },
    },
  })

  if (events.length === 0) return 0

  const portalUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/portal/${rule.association.slug}/evenements`
  let sent = 0

  const eventIds = events.map(e => e.id)
  const allLogs  = await prisma.automationLog.findMany({
    where:  { ruleId: rule.id, eventId: { in: eventIds } },
    select: { membreId: true, eventId: true },
  })
  const notifiedByEvent = new Map<string, Set<string>>()
  for (const log of allLogs) {
    if (!log.eventId || !log.membreId) continue
    if (!notifiedByEvent.has(log.eventId)) notifiedByEvent.set(log.eventId, new Set())
    notifiedByEvent.get(log.eventId)!.add(log.membreId)
  }

  for (const event of events) {
    const notifiedIds = notifiedByEvent.get(event.id) ?? new Set<string>()
    const targets = event.participations.filter(p => !notifiedIds.has(p.membreId))

    // Email
    if (opts.emailEnabled) {
      const emailJobs = targets
        .filter(p => p.membre.email)
        .map(p => {
          const { subject, html } = eventReminderEmail({
            firstName:       p.membre.firstName,
            email:           p.membre.email!,
            associationName: rule.association.name,
            eventTitle:      event.title,
            eventDate:       event.date,
            eventLocation:   event.location,
            portalUrl,
            daysBefore,
          })
          return { membreId: p.membreId, payload: { to: p.membre.email!, subject, html } }
        })

      for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
        const chunk = emailJobs.slice(i, i + BATCH_SIZE)
        const ok    = await sendEmailBatch(chunk.map(j => j.payload))
        if (ok) {
          await prisma.automationLog.createMany({
            data: chunk.map(j => ({ ruleId: rule.id, membreId: j.membreId, eventId: event.id, subject: j.payload.subject })),
          })
          sent += chunk.length
        }
      }
    }

    // SMS
    if (opts.smsEnabled && rule.template.smsBody) {
      const smsBody = rule.template.smsBody
      const smsJobs = targets
        .filter(p => p.membre.phone)
        .map(p => {
          const vars = buildVars({
            prenom:         p.membre.firstName,
            nom:            p.membre.lastName,
            email:          p.membre.email ?? "",
            association:    rule.association.name,
            slug:           rule.association.slug,
            titreEvenement: event.title,
            dateEvenement:  event.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }),
            lieuEvenement:  event.location ?? undefined,
          })
          return { membreId: p.membreId, to: p.membre.phone!, body: substituteVars(smsBody, vars) }
        })

      for (let i = 0; i < smsJobs.length; i += BATCH_SIZE) {
        const chunk   = smsJobs.slice(i, i + BATCH_SIZE)
        const results = await sendSmsBatch(chunk.map(j => ({ to: j.to, body: j.body })))
        const succeeded = chunk.filter((_, idx) => results[idx])
        if (succeeded.length > 0) {
          await prisma.automationLog.createMany({
            data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId, eventId: event.id })),
          })
          sent += succeeded.length
        }
      }
    }
  }

  return sent
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function updateRuleNextRun(
  id: string,
  triggerType: TriggerType,
  config: Record<string, unknown>,
  now: Date,
): Promise<number> {
  const nextRunAt = computeNextRunAt(triggerType, config) ?? new Date(now.getTime() + 86_400_000)
  await prisma.automationRule.update({ where: { id }, data: { lastRunAt: now, nextRunAt } })
  return 0
}

function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31, 23, 59, 59)
}
