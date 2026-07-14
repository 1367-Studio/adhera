import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { sendEmailBatch } from "@/lib/mail"
import { sendSmsBatch } from "@/lib/sms"
import { eventReminderEmail } from "@/lib/email"
import { substituteVars, buildVars, parseRecipients, computeNextRunAt, isBirthdayToday } from "@/lib/automation"
import { parseModules } from "@/lib/modules"
import { writeActivityLog } from "@/lib/activity-log"
import type { TriggerType, MessageChannel } from "@prisma/client"

const BATCH_SIZE = 100

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/automations] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
      // Atomically claim this rule so a concurrent/duplicate cron invocation processing
      // the same rule can't also send: only proceeds if nextRunAt still matches what we
      // just read. processRule always overwrites nextRunAt with the real value before
      // returning, so this transient bump is safely superseded on every code path.
      const claimed = await prisma.automationRule.updateMany({
        where: { id: rule.id, nextRunAt: rule.nextRunAt },
        data:  { nextRunAt: new Date(now.getTime() + 86_400_000) },
      })
      if (claimed.count === 0) continue

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

  // Don't bump lastRunAt here — the Rules tab already flags an inactive template on the
  // rule itself, and touching lastRunAt would make a dead rule look like it's still sending.
  if (!rule.template.active) {
    await bumpNextRunOnly(rule.id, rule.triggerType as TriggerType, rule.triggerConfig as Record<string, unknown>, now)
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

  if (triggerType === "MEMBER_BIRTHDAY") {
    const sent = await processBirthday(rule, now, { emailEnabled, smsEnabled })
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
      const results = await sendSmsBatch(chunk.map(j => ({ to: j.to, body: j.body })), rule.associationId)
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

// ── MEMBER_BIRTHDAY processor ─────────────────────────────────────────────────

async function processBirthday(
  rule: RuleWithRelations,
  now: Date,
  opts: { emailEnabled: boolean; smsEnabled: boolean },
): Promise<number> {
  const { mode, typeId } = parseRecipients(rule.recipients)

  const membres = await prisma.membre.findMany({
    where: {
      associationId: rule.associationId,
      status:        "ACTIF",
      deletedAt:     null,
      birthDate:     { not: null },
      ...(mode === "TYPE" && typeId ? { typeId } : {}),
    },
  })

  const todaysBirthdays = membres.filter(m => isBirthdayToday(m.birthDate!, now))
  if (todaysBirthdays.length === 0) return 0

  const yearStart = new Date(now.getFullYear(), 0, 1)
  const recentLogs = await prisma.automationLog.findMany({
    where:  { ruleId: rule.id, sentAt: { gte: yearStart }, membreId: { in: todaysBirthdays.map(m => m.id) } },
    select: { membreId: true },
  })
  const notifiedIds = new Set(recentLogs.map(l => l.membreId))
  const targets = todaysBirthdays.filter(m => !notifiedIds.has(m.id))

  const jobs = targets.map(membre => ({
    membreId: membre.id,
    membre,
    vars: buildVars({
      prenom:      membre.firstName,
      nom:         membre.lastName,
      email:       membre.email ?? "",
      association: rule.association.name,
      slug:        rule.association.slug,
    }),
  }))

  // Members reachable by neither enabled channel never get logged by the send loops
  // below, so without this the admin has no way to tell "0 sent" apart from "nobody had
  // a birthday today" — surface it once, in the activity feed they already check.
  const smsUsable = opts.smsEnabled && !!rule.template.smsBody
  const skippedNoContact = jobs.filter(j =>
    !(opts.emailEnabled && j.membre.email) && !(smsUsable && j.membre.phone),
  ).length
  if (skippedNoContact > 0) {
    await writeActivityLog({
      associationId: rule.associationId,
      action:        "AUTOMATION_SKIPPED_NO_CONTACT",
      entity:        "AutomationRule",
      entityId:      rule.id,
      label:         rule.name,
      metadata:      { skippedNoContact, birthdaysToday: targets.length },
    })
  }

  let sent = 0

  if (opts.emailEnabled) {
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

  if (opts.smsEnabled && rule.template.smsBody) {
    const smsJobs = jobs
      .filter(j => j.membre.phone)
      .map(j => ({
        membreId: j.membreId,
        to:       j.membre.phone!,
        body:     substituteVars(rule.template.smsBody!, j.vars),
      }))

    for (let i = 0; i < smsJobs.length; i += BATCH_SIZE) {
      const chunk   = smsJobs.slice(i, i + BATCH_SIZE)
      const results = await sendSmsBatch(chunk.map(j => ({ to: j.to, body: j.body })), rule.associationId)
      const succeeded = chunk.filter((_, idx) => results[idx])
      if (succeeded.length > 0) {
        await prisma.automationLog.createMany({
          data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId })),
        })
        sent += succeeded.length
      }
    }
  }

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
        include: { membre: { select: { phone: true } } },
      },
    },
  })

  if (events.length === 0) return 0

  const portalUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/portal/${rule.association.slug}/evenements`
  let sent = 0

  const eventIds = events.map(e => e.id)
  const allLogs  = await prisma.automationLog.findMany({
    where:  { ruleId: rule.id, eventId: { in: eventIds } },
    select: { participationId: true, eventId: true },
  })
  // Keyed by participationId (not membreId) so a guest with no Membre account — whose
  // participation row always has membreId null — is deduped correctly instead of being
  // re-sent the reminder on every cron run that finds them still within the day window.
  const notifiedByEvent = new Map<string, Set<string>>()
  for (const log of allLogs) {
    if (!log.eventId || !log.participationId) continue
    if (!notifiedByEvent.has(log.eventId)) notifiedByEvent.set(log.eventId, new Set())
    notifiedByEvent.get(log.eventId)!.add(log.participationId)
  }

  for (const event of events) {
    const notifiedIds = notifiedByEvent.get(event.id) ?? new Set<string>()
    const targets = event.participations.filter(p => !notifiedIds.has(p.id))

    // Email — name/email are snapshotted on the participation row itself, so this
    // works the same for a member's own ticket and for a guest who never had a Membre.
    if (opts.emailEnabled) {
      const emailJobs = targets
        .filter(p => p.email)
        .map(p => {
          const { subject, html } = eventReminderEmail({
            firstName:       p.firstName,
            email:           p.email!,
            associationName: rule.association.name,
            eventTitle:      event.title,
            eventDate:       event.date,
            eventLocation:   event.location,
            portalUrl,
            daysBefore,
          })
          return { membreId: p.membreId, participationId: p.id, payload: { to: p.email!, subject, html } }
        })

      for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
        const chunk = emailJobs.slice(i, i + BATCH_SIZE)
        const ok    = await sendEmailBatch(chunk.map(j => j.payload))
        if (ok) {
          await prisma.automationLog.createMany({
            data: chunk.map(j => ({ ruleId: rule.id, membreId: j.membreId, participationId: j.participationId, eventId: event.id, subject: j.payload.subject })),
          })
          sent += chunk.length
        }
      }
    }

    // SMS
    if (opts.smsEnabled && rule.template.smsBody) {
      const smsBody = rule.template.smsBody
      const smsJobs = targets
        .filter(p => p.membre?.phone)
        .map(p => {
          const vars = buildVars({
            prenom:         p.firstName,
            nom:            p.lastName,
            email:          p.email ?? "",
            association:    rule.association.name,
            slug:           rule.association.slug,
            titreEvenement: event.title,
            dateEvenement:  event.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }),
            lieuEvenement:  event.location ?? undefined,
          })
          return { membreId: p.membreId, participationId: p.id, to: p.membre!.phone!, body: substituteVars(smsBody, vars) }
        })

      for (let i = 0; i < smsJobs.length; i += BATCH_SIZE) {
        const chunk   = smsJobs.slice(i, i + BATCH_SIZE)
        const results = await sendSmsBatch(chunk.map(j => ({ to: j.to, body: j.body })), rule.associationId)
        const succeeded = chunk.filter((_, idx) => results[idx])
        if (succeeded.length > 0) {
          await prisma.automationLog.createMany({
            data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId, participationId: j.participationId, eventId: event.id })),
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

async function bumpNextRunOnly(
  id: string,
  triggerType: TriggerType,
  config: Record<string, unknown>,
  now: Date,
): Promise<void> {
  const nextRunAt = computeNextRunAt(triggerType, config) ?? new Date(now.getTime() + 86_400_000)
  await prisma.automationRule.update({ where: { id }, data: { nextRunAt } })
}

function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31, 23, 59, 59)
}
