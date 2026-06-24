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
