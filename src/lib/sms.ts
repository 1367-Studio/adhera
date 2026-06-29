import twilio from "twilio"

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
)

export class SmsSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SmsSendError"
  }
}

export async function sendSms(to: string, body: string): Promise<void> {
  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to,
      body,
    })
  } catch (err) {
    console.warn("[sms] sendSms failed:", err)
    throw new SmsSendError("Échec de l'envoi du SMS.")
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

export function rsvpConfirmationSms(p: {
  firstName:       string
  associationName: string
  eventTitle:      string
  eventDate:       Date
}): string {
  const dateStr = p.eventDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })
  const timeStr = p.eventDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  return `${p.associationName} — Bonjour ${p.firstName}, votre participation à « ${p.eventTitle} » le ${dateStr} à ${timeStr} est confirmée.`
}

export function eventReminderSms(p: {
  firstName:       string
  associationName: string
  eventTitle:      string
  eventDate:       Date
  daysBefore?:     number
}): string {
  const days = p.daysBefore ?? 1
  const when = days === 0 ? "aujourd'hui" : days === 1 ? "demain" : `dans ${days} jours`
  const timeStr = p.eventDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  return `${p.associationName} — Rappel : « ${p.eventTitle} » a lieu ${when} à ${timeStr}. À bientôt !`
}

export function welcomeSms(p: {
  firstName:       string
  associationName: string
}): string {
  return `${p.associationName} — Bienvenue, ${p.firstName} ! Votre adhésion a bien été enregistrée.`
}
