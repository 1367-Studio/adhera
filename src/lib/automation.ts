import { Prisma } from "@prisma/client"
import type { TriggerType } from "@prisma/client"
import { APP_URL } from "@/lib/env"

// ─── nextRunAt computation ────────────────────────────────────────────────────

export function computeNextRunAt(
  triggerType: TriggerType,
  config: Record<string, unknown>,
): Date | null {
  const now = new Date()

  if (triggerType === "SCHEDULED_ONCE") {
    const date = config.date as string
    const time = (config.time as string) ?? "09:00"
    if (!date) return null
    const [h, m] = time.split(":").map(Number)
    const d = new Date(date)
    d.setHours(h, m, 0, 0)
    return d
  }

  if (triggerType === "SCHEDULED_RECURRING") {
    return nextRecurring(config, now)
  }

  // Event-driven inline rules: never scheduled by cron
  if (triggerType === "RSVP_CONFIRMED" || triggerType === "MEMBER_CREATED") {
    return null
  }

  // MEMBER_BIRTHDAY: no config, runs daily like the other event-based rules below

  // Event-based rules (cotisation / payment / reminder): run daily, starting now
  return new Date(now.getTime())
}

function nextRecurring(config: Record<string, unknown>, from: Date): Date {
  const frequency   = config.frequency as "daily" | "weekly" | "monthly"
  const time        = (config.time as string) ?? "09:00"
  const [h, m]      = time.split(":").map(Number)
  const d           = new Date(from)

  if (frequency === "daily") {
    d.setDate(d.getDate() + 1)
  } else if (frequency === "weekly") {
    const target = (config.dayOfWeek as number) ?? 1
    let diff = (target - d.getDay() + 7) % 7
    if (diff === 0) diff = 7
    d.setDate(d.getDate() + diff)
  } else if (frequency === "monthly") {
    const dom = (config.dayOfMonth as number) ?? 1
    d.setMonth(d.getMonth() + 1, dom)
  }

  d.setHours(h, m, 0, 0)
  return d
}

// ─── Variable substitution ────────────────────────────────────────────────────

// Must stay in sync with the keys returned by buildVars() below — used to catch typos
// in template variables at creation time, before they can reach real recipients as a
// literal unresolved "{{...}}" token.
export const KNOWN_TEMPLATE_VARS = [
  "prenom", "nom", "nom_complet", "email", "association", "lien_portal",
  "annee_cotisation", "montant_cotisation", "titre_evenement", "date_evenement", "lieu_evenement",
] as const

export function findUnknownVars(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\{\{(\w+)\}\}/g)) {
    const key = match[1]
    if (!(KNOWN_TEMPLATE_VARS as readonly string[]).includes(key)) found.add(key)
  }
  return [...found]
}

export function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}

export function buildVars(params: {
  prenom:      string
  nom:         string
  email:       string
  association: string
  slug:        string
  anneeCotisation?:    number
  montantCotisation?:  string
  titreEvenement?:     string
  dateEvenement?:      string
  lieuEvenement?:      string
}): Record<string, string> {
  return {
    prenom:             params.prenom,
    nom:                params.nom,
    nom_complet:        `${params.prenom} ${params.nom}`.trim(),
    email:              params.email,
    association:        params.association,
    lien_portal:        `${APP_URL}/portal/${params.slug}`,
    annee_cotisation:   params.anneeCotisation?.toString() ?? "",
    montant_cotisation: params.montantCotisation ?? "",
    titre_evenement:    params.titreEvenement  ?? "",
    date_evenement:     params.dateEvenement   ?? "",
    lieu_evenement:     params.lieuEvenement   ?? "",
  }
}

// ─── Recipient filtering ──────────────────────────────────────────────────────

export function parseRecipients(value: string): { mode: "ALL" | "TYPE"; typeId?: string } {
  if (value.startsWith("TYPE:")) return { mode: "TYPE", typeId: value.slice(5) }
  return { mode: "ALL" }
}

// ─── Birthday matching ────────────────────────────────────────────────────────

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

// Feb 29 birthdays fire on Feb 28 in non-leap years, so they still get one email a year
// instead of being skipped 3 years out of 4.
export function isBirthdayToday(birthDate: Date, now: Date): boolean {
  const bMonth = birthDate.getMonth()
  const bDate  = birthDate.getDate()
  if (bMonth === now.getMonth() && bDate === now.getDate()) return true
  return bMonth === 1 && bDate === 29 && !isLeapYear(now.getFullYear()) && now.getMonth() === 1 && now.getDate() === 28
}

// "ALL" always overlaps every other recipient scope (it includes their members too), so
// it conflicts with any other active birthday rule regardless of that rule's recipients.
export function birthdayRecipientsConflict(recipients: string, otherActiveRecipients: string[]): boolean {
  if (recipients === "ALL") return otherActiveRecipients.length > 0
  return otherActiveRecipients.some(r => r === "ALL" || r === recipients)
}

export const BIRTHDAY_CONFLICT_MESSAGE = "BIRTHDAY_CONFLICT"

// P2034 = Prisma's serialization-failure code, thrown when the serializable transaction
// wrapping the birthday-rule duplicate check detects a write conflict with a concurrent
// request — treat it the same as the in-app conflict thrown inside that transaction.
export function isBirthdayConflictError(err: unknown): boolean {
  if (err instanceof Error && err.message === BIRTHDAY_CONFLICT_MESSAGE) return true
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034"
}

// ─── Template categories ──────────────────────────────────────────────────────

export const TEMPLATE_CATEGORIES = ["GENERAL", "COTISATION", "EVENEMENT", "MEMBRE", "FACTURATION"] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  GENERAL:     "Général",
  COTISATION:  "Cotisation",
  EVENEMENT:   "Événement",
  MEMBRE:      "Membre",
  FACTURATION: "Facturation",
}
