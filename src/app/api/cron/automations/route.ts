import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { eventReminderEmail } from "@/lib/email"
import { substituteVars, buildVars, parseRecipients, computeNextRunAt } from "@/lib/automation"
import type { TriggerType } from "@prisma/client"

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
      status:    "ACTIVE",
      nextRunAt: { lte: now },
    },
    include: {
      template:    true,
      association: { select: { id: true, name: true, slug: true } },
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
  include: { template: true; association: { select: { id: true; name: true; slug: true } } }
}>>>[number]

async function processRule(rule: RuleWithRelations, now: Date): Promise<number> {
  const { mode, typeId } = parseRecipients(rule.recipients)
  const triggerType = rule.triggerType as TriggerType
  const config = rule.triggerConfig as Record<string, unknown>

  // ── EVENT_REMINDER: send to event participants N days before the event ───────
  if (triggerType === "EVENT_REMINDER") {
    const sent = await processEventReminder(rule, config, now)
    await updateRuleNextRun(rule.id, triggerType, config, now)
    return sent
  }

  // For event-based cotisation rules, check cooldown per member (default 7 days)
  const cooldownDays = (config.cooldownDays as number | undefined) ?? 7
  const cooldownCutoff = new Date(now.getTime() - cooldownDays * 86_400_000)

  let membres = await prisma.membre.findMany({
    where: {
      associationId: rule.associationId,
      status:        "ACTIF",
      deletedAt:     null,
      email:         { not: null },
      ...(mode === "TYPE" && typeId ? { typeId } : {}),
    },
    include: {
      cotisations: {
        where: { status: "EN_ATTENTE" },
        orderBy: { year: "desc" },
        take: 1,
      },
    },
  })

  // Filter by event condition
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

  // For event rules, filter out members already notified within cooldown
  let targets = membres
  if (triggerType === "EVENT_COTISATION_DUE" || triggerType === "EVENT_PAYMENT_OVERDUE") {
    const recentLogs = await prisma.automationLog.findMany({
      where: {
        ruleId:   rule.id,
        sentAt:   { gte: cooldownCutoff },
        membreId: { in: membres.map(m => m.id) },
      },
      select: { membreId: true },
    })
    const notifiedIds = new Set(recentLogs.map(l => l.membreId))
    targets = membres.filter(m => !notifiedIds.has(m.id))
  }

  let sent = 0
  for (const membre of targets) {
    if (!membre.email) continue

    const cotisation = membre.cotisations[0]
    const vars = buildVars({
      prenom:             membre.firstName,
      nom:                membre.lastName,
      email:              membre.email,
      association:        rule.association.name,
      slug:               rule.association.slug,
      anneeCotisation:    cotisation?.year,
      montantCotisation:  cotisation ? cotisation.amount.toString() : undefined,
    })

    const subject = substituteVars(rule.template.subject, vars)
    const html    = substituteVars(rule.template.body,    vars)

    await sendEmail({ to: membre.email, subject, html })
    await prisma.automationLog.create({
      data: { ruleId: rule.id, membreId: membre.id, subject },
    })
    sent++
  }

  // Update rule after run
  const isOnce    = triggerType === "SCHEDULED_ONCE"
  const nextRunAt = isOnce ? null : computeNextRunAt(triggerType, config)

  await prisma.automationRule.update({
    where: { id: rule.id },
    data:  {
      lastRunAt: now,
      nextRunAt,
      status:    isOnce ? "DONE" : "ACTIVE",
    },
  })

  return sent
}

// ── EVENT_REMINDER processor ────────────────────────────────────────────────────

async function processEventReminder(
  rule: RuleWithRelations,
  config: Record<string, unknown>,
  now: Date,
): Promise<number> {
  const daysBefore = (config.daysBefore as number) ?? 1

  const target   = new Date(now.getTime() + daysBefore * 86_400_000)
  const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 0, 0, 0)
  const dayEnd   = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59, 59)

  const events = await prisma.evenement.findMany({
    where: {
      associationId: rule.associationId,
      date: { gte: dayStart, lte: dayEnd },
    },
    include: {
      participations: {
        where: { rsvp: { in: ["CONFIRME", "PROVAVEL"] } },
        include: { membre: { select: { id: true, firstName: true, email: true } } },
      },
    },
  })

  const portalUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/portal/${rule.association.slug}/evenements`
  let sent = 0

  for (const event of events) {
    const alreadyNotified = await prisma.automationLog.findMany({
      where: { ruleId: rule.id, eventId: event.id },
      select: { membreId: true },
    })
    const notifiedIds = new Set(alreadyNotified.map(l => l.membreId))

    for (const p of event.participations) {
      if (!p.membre.email) continue
      if (notifiedIds.has(p.membreId)) continue

      const { subject, html } = eventReminderEmail({
        firstName:       p.membre.firstName,
        email:           p.membre.email,
        associationName: rule.association.name,
        eventTitle:      event.title,
        eventDate:       event.date,
        eventLocation:   event.location,
        portalUrl,
        daysBefore,
      })

      await sendEmail({ to: p.membre.email, subject, html })
      await prisma.automationLog.create({
        data: { ruleId: rule.id, membreId: p.membreId, eventId: event.id, subject },
      })
      sent++
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
