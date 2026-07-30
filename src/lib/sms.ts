import twilio from "twilio"
import { prisma } from "@/lib/prisma/client"

export class SmsSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SmsSendError"
  }
}

type Credentials = { smsAccountSid: string; smsAuthToken: string; smsPhoneNumber: string }

async function getCredentials(associationId: string): Promise<Credentials> {
  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { smsAccountSid: true, smsAuthToken: true, smsPhoneNumber: true },
  })
  if (!assoc?.smsAccountSid || !assoc.smsAuthToken || !assoc.smsPhoneNumber) {
    throw new SmsSendError("Twilio non configuré pour cette association.")
  }
  return assoc as Credentials
}

// Twilio error codes worth surfacing to the user instead of the generic failure message.
// https://www.twilio.com/docs/api/errors
const TWILIO_ERROR_REASONS: Record<number, string> = {
  21211: "Numéro de téléphone invalide.",
  21608: "Numéro non vérifié (compte Twilio d'essai).",
  21610: "Le destinataire a désactivé la réception de SMS.",
  21614: "Numéro de téléphone incapable de recevoir des SMS.",
  21659: "Numéro d'expéditeur Twilio invalide ou incompatible avec le pays du destinataire.",
}

function twilioErrorReason(err: unknown): string {
  const code = (err as { code?: number } | undefined)?.code
  if (code !== undefined && TWILIO_ERROR_REASONS[code]) return TWILIO_ERROR_REASONS[code]
  return "Échec de l'envoi du SMS."
}

async function sendWithCredentials(creds: Credentials, to: string, body: string): Promise<void> {
  try {
    await twilio(creds.smsAccountSid, creds.smsAuthToken).messages.create({ from: creds.smsPhoneNumber, to, body })
  } catch (err) {
    console.warn("[sms] sendSms failed:", err)
    throw new SmsSendError(twilioErrorReason(err))
  }
}

export async function sendSms(to: string, body: string, associationId: string): Promise<void> {
  const creds = await getCredentials(associationId)
  await sendWithCredentials(creds, to, body)
}

// One entry per input job, same order — mirrors sendEmailBatch's BatchItemResult so callers
// can tell exactly which recipients failed and why.
export type SmsBatchItemResult = { to: string; ok: boolean; reason?: string }

export async function sendSmsBatch(
  jobs: { to: string; body: string }[],
  associationId: string,
): Promise<SmsBatchItemResult[]> {
  if (jobs.length === 0) return []

  let creds: Credentials
  try {
    creds = await getCredentials(associationId)
  } catch (err) {
    const reason = err instanceof SmsSendError ? err.message : "Échec de l'envoi du SMS."
    return jobs.map(j => ({ to: j.to, ok: false, reason }))
  }

  const results = await Promise.allSettled(jobs.map(j => sendWithCredentials(creds, j.to, j.body)))
  return results.map((r, i) => r.status === "fulfilled"
    ? { to: jobs[i].to, ok: true }
    : { to: jobs[i].to, ok: false, reason: r.reason instanceof SmsSendError ? r.reason.message : "Échec de l'envoi du SMS." })
}
