import { format } from "date-fns"
import { prisma } from "@/lib/prisma/client"
import { APP_TIME_ZONE } from "@/lib/date-format"
import { sendEmailBatch } from "@/lib/mail"
import { sendSmsBatch } from "@/lib/sms"
import { eventReminderEmail, customEmail } from "@/lib/email"
import { substituteVars, buildVars, parseRecipients, computeNextRunAt, isBirthdayToday } from "@/lib/automation"
import { translateEmailContent } from "@/lib/i18n/translate"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { parseModules } from "@/lib/modules"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { currentCotisationYear, endOfCotisationYear, parisDayBounds, isMembreAdherent, membreAdherentResponsableSelect } from "@/lib/membre-adherent"
import { nextAmountDue } from "@/lib/cotisation-status"
import type { TriggerType, MessageChannel } from "@prisma/client"
import { APP_URL } from "@/lib/env"

const BATCH_SIZE = 100

// One translateEmailContent call per distinct Membre.preferredLocale actually present among
// this run's email-reachable targets (never per member — see the identical reasoning in
// src/inngest/bulk-send.ts, which this mirrors). Returns an empty map (no-op downstream) when
// every target is on the default locale or has none set, without making any network/DB call.
async function localizeTemplateContent(
  associationId: string,
  subject:       string,
  body:          string,
  emailJobs:     { membre: { preferredLocale: string | null } }[],
): Promise<Map<string, { subject: string; body: string }>> {
  const locales = [...new Set(
    emailJobs.map(j => j.membre.preferredLocale).filter((l): l is Locale => !!l && l !== DEFAULT_LOCALE)
  )]
  if (locales.length === 0) return new Map()

  const entries = await Promise.all(locales.map(async (locale) => {
    const result = await translateEmailContent(subject, body, locale, associationId)
    return [locale, { subject: result.subject, body: result.bodyHtml }] as const
  }))
  return new Map(entries)
}

export const automationRuleInclude = {
  template:    true,
  association: { select: { id: true, name: true, slug: true, modules: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
} as const

export type RuleWithRelations = Awaited<ReturnType<typeof prisma.automationRule.findMany<{
  include: typeof automationRuleInclude
}>>>[number]

// Atomically claims every AutomationRule that's currently due, so two concurrent callers
// (e.g. the legacy Vercel cron and the Inngest sweep running side by side during cutover)
// can't both send for the same rule: the CAS on nextRunAt means only one caller's
// updateMany matches per rule. processRule always overwrites nextRunAt with the real value
// before returning, so this transient bump is safely superseded on every code path.
export async function claimDueAutomationRules(now: Date): Promise<RuleWithRelations[]> {
  const rules = await prisma.automationRule.findMany({
    where: {
      status:      "ACTIVE",
      nextRunAt:   { lte: now },
      triggerType: { notIn: ["RSVP_CONFIRMED", "MEMBER_CREATED"] },
    },
    include: automationRuleInclude,
  })

  const claimed: RuleWithRelations[] = []
  for (const rule of rules) {
    try {
      const result = await prisma.automationRule.updateMany({
        where: { id: rule.id, nextRunAt: rule.nextRunAt },
        data:  { nextRunAt: new Date(now.getTime() + 86_400_000) },
      })
      if (result.count > 0) claimed.push(rule)
    } catch (err) {
      console.error(`[automation] Failed to claim rule ${rule.id}:`, err)
    }
  }
  return claimed
}

export async function processRule(rule: RuleWithRelations, now: Date): Promise<number> {
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

  if (triggerType === "EVENT_ADHERENT_LAPSED") {
    const sent = await processAdherentLapsed(rule, config, now, { emailEnabled, smsEnabled })
    await updateRuleNextRun(rule.id, triggerType, config, now)
    return sent
  }

  if (triggerType === "MEMBERSHIP_EXPIRING") {
    const sent = await processMembershipExpiring(rule, config, now, { emailEnabled, smsEnabled })
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
        // A partially-paid or already-late member still owes something — they should get
        // the same "due"/"overdue" nudges as someone who hasn't paid anything yet, not go
        // silent the moment a first payment is recorded or the due date quietly passes.
        where:   { status: { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] } },
        orderBy: { year: "desc" },
        take:    1,
        include: { installments: { select: { amount: true, dueDate: true, order: true } } },
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
      // The next amount actually due — the next unpaid échéance when the cotisation has an
      // installment schedule, otherwise the full remaining balance. Either way, not the
      // cotisation's sticker amount: that diverges once a partial payment has been recorded,
      // and the reminder should ask for what's actually still owed right now.
      montantCotisation: cotisation ? nextAmountDue({
        amount:       Number(cotisation.amount),
        amountPaid:   Number(cotisation.amountPaid),
        installments: cotisation.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
      }).toFixed(2) : undefined,
    })
    return { membreId: membre.id, membre, vars }
  })

  let sent = 0

  // Email dispatch
  if (emailEnabled) {
    const branding      = resolveDocumentBranding(rule.association)
    const emailTargets  = jobs.filter(j => j.membre.email)
    const translations  = await localizeTemplateContent(rule.associationId, rule.template.subject, rule.template.body, emailTargets)
    const emailJobs = emailTargets
      .map(j => {
        const content = (j.membre.preferredLocale && translations.get(j.membre.preferredLocale)) || { subject: rule.template.subject, body: rule.template.body }
        return {
          membreId: j.membreId,
          payload: {
            ...customEmail({
              associationName: rule.association.name,
              subject:         substituteVars(content.subject, j.vars),
              bodyHtml:        substituteVars(content.body, j.vars),
              recipientEmail:  j.membre.email!,
              branding,
            }),
            context: { associationId: rule.associationId, membreId: j.membreId, source: "AUTOMATION", sourceId: rule.id },
          },
        }
      })

    for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
      const chunk     = emailJobs.slice(i, i + BATCH_SIZE)
      const results   = await sendEmailBatch(chunk.map(j => j.payload))
      const succeeded = chunk.filter((_, idx) => results[idx].ok)
      if (succeeded.length > 0) {
        await prisma.automationLog.createMany({
          data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId, subject: j.payload.subject })),
        })
        sent += succeeded.length
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
      const results = await sendSmsBatch(
        chunk.map(j => ({ to: j.to, body: j.body, membreId: j.membreId })),
        rule.associationId,
        { source: "AUTOMATION", sourceId: rule.id },
      )
      const succeeded = chunk.filter((_, idx) => results[idx].ok)
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
    const branding      = resolveDocumentBranding(rule.association)
    const emailTargets  = jobs.filter(j => j.membre.email)
    const translations  = await localizeTemplateContent(rule.associationId, rule.template.subject, rule.template.body, emailTargets)
    const emailJobs = emailTargets
      .map(j => {
        const content = (j.membre.preferredLocale && translations.get(j.membre.preferredLocale)) || { subject: rule.template.subject, body: rule.template.body }
        return {
          membreId: j.membreId,
          payload: {
            ...customEmail({
              associationName: rule.association.name,
              subject:         substituteVars(content.subject, j.vars),
              bodyHtml:        substituteVars(content.body, j.vars),
              recipientEmail:  j.membre.email!,
              branding,
            }),
            context: { associationId: rule.associationId, membreId: j.membreId, source: "AUTOMATION", sourceId: rule.id },
          },
        }
      })

    for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
      const chunk     = emailJobs.slice(i, i + BATCH_SIZE)
      const results   = await sendEmailBatch(chunk.map(j => j.payload))
      const succeeded = chunk.filter((_, idx) => results[idx].ok)
      if (succeeded.length > 0) {
        await prisma.automationLog.createMany({
          data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId, subject: j.payload.subject })),
        })
        sent += succeeded.length
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
      const results = await sendSmsBatch(
        chunk.map(j => ({ to: j.to, body: j.body, membreId: j.membreId })),
        rule.associationId,
        { source: "AUTOMATION", sourceId: rule.id },
      )
      const succeeded = chunk.filter((_, idx) => results[idx].ok)
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

// ── EVENT_ADHERENT_LAPSED processor ──────────────────────────────────────────

// Members who were adhérent last year (own cotisation PAYE/EXONERE) but have no
// qualifying cotisation for the current year yet. adherentOverride: null excludes anyone
// an admin has manually forced either way — their status isn't tied to renewal, so
// nagging them about it would be noise. Dependents usually never match here since they
// never have their own cotisation history to begin with — nothing to "lapse" — but a
// member who *used to* have their own cotisation and was only later attached to a
// responsable is still filtered out below if that responsable currently makes them
// adhérent again, so this never nags someone isMembreAdherent() reports as current.
// Staff (linked User.role other than MEMBRE) are excluded too — same reasoning as the
// registration-time cotisation nudge in src/app/api/membres/route.ts: they were invited to
// help run the association, not as dues-paying members, so a lapsed-renewal nag would be as
// much of a non-sequitur here as the welcome-time one would've been. A Membre with no linked
// User at all isn't "staff" and stays eligible.
async function processAdherentLapsed(
  rule: RuleWithRelations,
  config: Record<string, unknown>,
  now: Date,
  opts: { emailEnabled: boolean; smsEnabled: boolean },
): Promise<number> {
  const { mode, typeId } = parseRecipients(rule.recipients)
  const year     = currentCotisationYear(now)
  const lastYear = year - 1

  const candidates = await prisma.membre.findMany({
    where: {
      associationId:    rule.associationId,
      status:           "ACTIF",
      deletedAt:        null,
      adherentOverride: null,
      OR: [{ userId: null }, { user: { role: "MEMBRE" } }],
      cotisations: {
        some: { year: lastYear, status: { in: ["PAYE", "EXONERE"] } },
        none: { year, status: { in: ["PAYE", "EXONERE"] } },
      },
      ...(mode === "TYPE" && typeId ? { typeId } : {}),
    },
    include: { responsable: membreAdherentResponsableSelect(now) },
  })

  // The where clause above already guarantees each candidate has no qualifying cotisation
  // of their own for the current year and no override, so their own status is always
  // undetermined here — isMembreAdherent() only has the responsable fallback left to check.
  const membres = candidates.filter(m => !isMembreAdherent({ ...m, cotisations: [] }, now))

  if (membres.length === 0) return 0

  const cooldownDays   = (config.cooldownDays as number | undefined) ?? 30
  const cooldownCutoff = new Date(now.getTime() - cooldownDays * 86_400_000)
  const recentLogs = await prisma.automationLog.findMany({
    where:  { ruleId: rule.id, sentAt: { gte: cooldownCutoff }, membreId: { in: membres.map(m => m.id) } },
    select: { membreId: true },
  })
  const notifiedIds = new Set(recentLogs.map(l => l.membreId))
  const targets = membres.filter(m => !notifiedIds.has(m.id))

  const jobs = targets.map(membre => ({
    membreId: membre.id,
    membre,
    vars: buildVars({
      prenom:          membre.firstName,
      nom:             membre.lastName,
      email:           membre.email ?? "",
      association:     rule.association.name,
      slug:            rule.association.slug,
      anneeCotisation: year,
    }),
  }))

  let sent = 0

  if (opts.emailEnabled) {
    const branding      = resolveDocumentBranding(rule.association)
    const emailTargets  = jobs.filter(j => j.membre.email)
    const translations  = await localizeTemplateContent(rule.associationId, rule.template.subject, rule.template.body, emailTargets)
    const emailJobs = emailTargets
      .map(j => {
        const content = (j.membre.preferredLocale && translations.get(j.membre.preferredLocale)) || { subject: rule.template.subject, body: rule.template.body }
        return {
          membreId: j.membreId,
          payload: {
            ...customEmail({
              associationName: rule.association.name,
              subject:         substituteVars(content.subject, j.vars),
              bodyHtml:        substituteVars(content.body, j.vars),
              recipientEmail:  j.membre.email!,
              branding,
            }),
            context: { associationId: rule.associationId, membreId: j.membreId, source: "AUTOMATION", sourceId: rule.id },
          },
        }
      })

    for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
      const chunk     = emailJobs.slice(i, i + BATCH_SIZE)
      const results   = await sendEmailBatch(chunk.map(j => j.payload))
      const succeeded = chunk.filter((_, idx) => results[idx].ok)
      if (succeeded.length > 0) {
        await prisma.automationLog.createMany({
          data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId, subject: j.payload.subject })),
        })
        sent += succeeded.length
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
      const results = await sendSmsBatch(
        chunk.map(j => ({ to: j.to, body: j.body, membreId: j.membreId })),
        rule.associationId,
        { source: "AUTOMATION", sourceId: rule.id },
      )
      const succeeded = chunk.filter((_, idx) => results[idx].ok)
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

// ── MEMBERSHIP_EXPIRING processor ────────────────────────────────────────────

// A Cotisation's own expiration instant — periodEnd when set (custom-duration
// MembershipTier), otherwise the last instant of its calendar year. Mirrors exactly the rule
// cotisationCoversInYear (src/lib/membre-adherent.ts) uses to decide Adhérent coverage, so a
// reminder fires precisely when the member's status is about to lapse.
function cotisationExpiresAt(cotisation: { year: number; periodEnd: Date | null }): Date {
  return cotisation.periodEnd ?? endOfCotisationYear(cotisation.year)
}

// Who actually gets the reminder for a given Cotisation — the member themselves when they
// have their own email/phone, otherwise their responsable's (a dependent created through a
// multi-registrant adhésion — see the checkout route's responsableId wiring — always has
// email: null of their own; without this fallback their membership silently expires with
// nobody, including the responsable who's actually paying for and managing them, ever
// finding out). The email content still greets the dependent by their own name (`vars` below
// is built from the Cotisation's own membre, not this), so the message reads as being about
// them even though it lands in the responsable's inbox.
type ContactSource = { email: string | null; phone: string | null; preferredLocale: string | null }
function resolveContact(membre: ContactSource, responsable: ContactSource | null): ContactSource {
  if (membre.email || membre.phone) return membre
  return responsable ?? membre
}

async function processMembershipExpiring(
  rule: RuleWithRelations,
  config: Record<string, unknown>,
  now: Date,
  opts: { emailEnabled: boolean; smsEnabled: boolean },
): Promise<number> {
  const { mode, typeId } = parseRecipients(rule.recipients)
  const daysBefore = (config.daysBefore as number | undefined) ?? 30
  const target     = new Date(now.getTime() + daysBefore * 86_400_000)
  // Paris-precise, not server-local (server runs in UTC) — has to agree exactly with
  // endOfCotisationYear()'s own Paris-precise instant below, or a calendar-year Cotisation
  // could be judged as expiring on the wrong side of midnight near a DST change.
  const { dayStart, dayEnd } = parisDayBounds(target)

  // Only PAYE/EXONERE rows can expire in a way that matters — an unpaid one was never
  // covering the member to begin with (see ADHERENT_STATUSES). adherentOverride: null
  // excludes anyone an admin has manually forced either way, same reasoning as
  // processAdherentLapsed above: their status isn't tied to renewal, so nagging them about a
  // Cotisation that doesn't even determine it would be a non-sequitur. The subscriptionId
  // exclusion below skips a row backed by a still-ACTIVE CotisationSubscription: Stripe is
  // going to auto-charge and produce next period's Cotisation on its own, so a "renew now"
  // email with a fresh-checkout link would be actively wrong for these — they need a
  // different message (or none), not this one. The OR below is a broad net (periodEnd
  // in-window, or a plain calendar-year row from this or last year) narrowed exactly by
  // cotisationExpiresAt() in JS afterwards, since a periodEnd-less row's real expiration
  // depends on `year` through endOfCotisationYear — not something Prisma's query language can
  // express directly.
  const candidates = await prisma.cotisation.findMany({
    where: {
      associationId: rule.associationId,
      status:        { in: ["PAYE", "EXONERE"] },
      membre:        { status: "ACTIF", deletedAt: null, adherentOverride: null, ...(mode === "TYPE" && typeId ? { typeId } : {}) },
      NOT: { AND: [{ subscriptionId: { not: null } }, { subscription: { status: "ACTIVE" } }] },
      OR: [
        { periodEnd: { gte: dayStart, lte: dayEnd } },
        { periodEnd: null, year: { in: [target.getFullYear() - 1, target.getFullYear()] } },
      ],
    },
    select: {
      id: true, membreId: true, year: true, periodEnd: true,
      membre: {
        select: {
          firstName: true, lastName: true, email: true, phone: true, preferredLocale: true,
          responsable: { select: { email: true, phone: true, preferredLocale: true } },
        },
      },
    },
  })

  const expiring = candidates.filter(c => {
    const expiresAt = cotisationExpiresAt(c)
    return expiresAt >= dayStart && expiresAt <= dayEnd
  })

  if (expiring.length === 0) return 0

  // "Already renewed" — the member holds another PAYE/EXONERE Cotisation whose own
  // expiration is later than this one's, regardless of year bookkeeping (works the same way
  // for the calendar-year and custom-duration cases). Fetched separately from `candidates`
  // above, which only looked at rows expiring in this exact window.
  const membreIds      = [...new Set(expiring.map(c => c.membreId))]
  const allCotisations = await prisma.cotisation.findMany({
    where:  { membreId: { in: membreIds }, status: { in: ["PAYE", "EXONERE"] } },
    select: { id: true, membreId: true, year: true, periodEnd: true },
  })
  const byMembre = new Map<string, typeof allCotisations>()
  for (const c of allCotisations) {
    if (!byMembre.has(c.membreId)) byMembre.set(c.membreId, [])
    byMembre.get(c.membreId)!.push(c)
  }

  const notRenewed = expiring.filter(c => {
    const expiresAt = cotisationExpiresAt(c)
    return !byMembre.get(c.membreId)!.some(other => other.id !== c.id && cotisationExpiresAt(other) > expiresAt)
  })

  if (notRenewed.length === 0) return 0

  // Keyed by cotisationId (not membreId) so a member's next-year/next-period reminder isn't
  // silently swallowed by a log row left over from a previous membership period — same
  // reasoning as participationId on the EVENT_REMINDER processor above.
  const recentLogs = await prisma.automationLog.findMany({
    where:  { ruleId: rule.id, cotisationId: { in: notRenewed.map(c => c.id) } },
    select: { cotisationId: true },
  })
  const notifiedIds = new Set(recentLogs.map(l => l.cotisationId))
  const targets = notRenewed.filter(c => !notifiedIds.has(c.id))

  if (targets.length === 0) return 0

  const jobs = targets.map(cotisation => {
    const expiresAt = cotisationExpiresAt(cotisation)
    const contact   = resolveContact(cotisation.membre, cotisation.membre.responsable)
    const locale    = (contact.preferredLocale as Locale | null) ?? DEFAULT_LOCALE
    return {
      cotisationId: cotisation.id,
      membreId:     cotisation.membreId,
      membre:       contact,
      vars: buildVars({
        prenom:             cotisation.membre.firstName,
        nom:                cotisation.membre.lastName,
        email:              contact.email ?? "",
        association:        rule.association.name,
        slug:               rule.association.slug,
        // Formatted per the recipient's own preferredLocale, not the association's language —
        // otherwise a translated subject/body (see localizeTemplateContent below) would still
        // carry a French-formatted date in the middle of it.
        dateExpiration:     format(expiresAt, "d MMMM yyyy", { locale: getDateFnsLocale(locale) }),
        // The member portal, always — NOT the public adhésion form: that form's checkout
        // route unconditionally rejects any email that already belongs to an existing Membre
        // in the association ("Cette adresse email est déjà utilisée", 409), which is exactly
        // every real recipient of this reminder. There is currently no self-service flow
        // anywhere in the app for an existing member to start paying for their *next*
        // membership period — the portal's own cotisation page can only pay a Cotisation that
        // already exists (see /api/portal/cotisation/checkout) — so this link can't yet offer
        // a one-click renewal; it's the least-wrong place to send someone today, and the
        // association still needs a way to actually collect the renewal (mention it in the
        // template body, or handle it manually) until a real renewal flow exists.
        lienRenouvellement: `${APP_URL}/portal/${rule.association.slug}`,
      }),
    }
  })

  let sent = 0

  if (opts.emailEnabled) {
    const branding      = resolveDocumentBranding(rule.association)
    const emailTargets  = jobs.filter(j => j.membre.email)
    const translations  = await localizeTemplateContent(rule.associationId, rule.template.subject, rule.template.body, emailTargets)
    const emailJobs = emailTargets
      .map(j => {
        const content = (j.membre.preferredLocale && translations.get(j.membre.preferredLocale)) || { subject: rule.template.subject, body: rule.template.body }
        return {
          cotisationId: j.cotisationId,
          membreId:     j.membreId,
          payload: {
            ...customEmail({
              associationName: rule.association.name,
              subject:         substituteVars(content.subject, j.vars),
              bodyHtml:        substituteVars(content.body, j.vars),
              recipientEmail:  j.membre.email!,
              branding,
            }),
            context: { associationId: rule.associationId, membreId: j.membreId, source: "AUTOMATION", sourceId: rule.id },
          },
        }
      })

    for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
      const chunk     = emailJobs.slice(i, i + BATCH_SIZE)
      const results   = await sendEmailBatch(chunk.map(j => j.payload))
      const succeeded = chunk.filter((_, idx) => results[idx].ok)
      if (succeeded.length > 0) {
        await prisma.automationLog.createMany({
          data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId, cotisationId: j.cotisationId, subject: j.payload.subject })),
        })
        sent += succeeded.length
      }
    }
  }

  if (opts.smsEnabled && rule.template.smsBody) {
    const smsJobs = jobs
      .filter(j => j.membre.phone)
      .map(j => ({ cotisationId: j.cotisationId, membreId: j.membreId, to: j.membre.phone!, body: substituteVars(rule.template.smsBody!, j.vars) }))

    for (let i = 0; i < smsJobs.length; i += BATCH_SIZE) {
      const chunk   = smsJobs.slice(i, i + BATCH_SIZE)
      const results = await sendSmsBatch(
        chunk.map(j => ({ to: j.to, body: j.body, membreId: j.membreId })),
        rule.associationId,
        { source: "AUTOMATION", sourceId: rule.id },
      )
      const succeeded = chunk.filter((_, idx) => results[idx].ok)
      if (succeeded.length > 0) {
        await prisma.automationLog.createMany({
          data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId, cotisationId: j.cotisationId })),
        })
        sent += succeeded.length
      }
    }
  }

  // Targets reachable by neither enabled channel never get logged by the send loops above,
  // so without this the admin has no way to tell "0 sent" apart from "nobody's expiring" —
  // same visibility processBirthday already gives its own silent-skip case.
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
      metadata:      { skippedNoContact, expiringCount: targets.length },
    })
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

  const portalUrl = `${APP_URL}/portal/${rule.association.slug}/evenements`
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
            branding:        resolveDocumentBranding(rule.association),
          })
          return {
            membreId:        p.membreId,
            participationId: p.id,
            payload: {
              to: p.email!, subject, html,
              context: { associationId: rule.associationId, membreId: p.membreId ?? undefined, source: "AUTOMATION", sourceId: rule.id },
            },
          }
        })

      for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
        const chunk     = emailJobs.slice(i, i + BATCH_SIZE)
        const results   = await sendEmailBatch(chunk.map(j => j.payload))
        const succeeded = chunk.filter((_, idx) => results[idx].ok)
        if (succeeded.length > 0) {
          await prisma.automationLog.createMany({
            data: succeeded.map(j => ({ ruleId: rule.id, membreId: j.membreId, participationId: j.participationId, eventId: event.id, subject: j.payload.subject })),
          })
          sent += succeeded.length
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
            dateEvenement:  event.date.toLocaleDateString("fr-FR", { timeZone: APP_TIME_ZONE, day: "numeric", month: "long" }),
            lieuEvenement:  event.location ?? undefined,
          })
          return { membreId: p.membreId, participationId: p.id, to: p.membre!.phone!, body: substituteVars(smsBody, vars) }
        })

      for (let i = 0; i < smsJobs.length; i += BATCH_SIZE) {
        const chunk   = smsJobs.slice(i, i + BATCH_SIZE)
        const results = await sendSmsBatch(
          chunk.map(j => ({ to: j.to, body: j.body, membreId: j.membreId ?? undefined })),
          rule.associationId,
          { source: "AUTOMATION", sourceId: rule.id },
        )
        const succeeded = chunk.filter((_, idx) => results[idx].ok)
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
