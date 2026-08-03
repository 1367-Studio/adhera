import twilio from "twilio"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"

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

// Shared by both the synchronous Twilio API rejection path (err.code) and the async
// status-callback webhook (ErrorCode form field) — same French messages either way.
export function twilioErrorReasonForCode(code: number | undefined): string {
  if (code !== undefined && TWILIO_ERROR_REASONS[code]) return TWILIO_ERROR_REASONS[code]
  return "Échec de l'envoi du SMS."
}

function twilioErrorReason(err: unknown): string {
  const code = (err as { code?: number } | undefined)?.code
  return twilioErrorReasonForCode(code)
}

// Attached to every send so the Twilio status webhook (src/app/api/webhook/twilio/[associationId])
// can later match delivery/failure callbacks back to a row, and the Membre SMS history can
// query by membreId — mirrors EmailContext in src/lib/mail.ts.
export type SmsContext = {
  membreId?: string
  source:    string
  sourceId?: string
}

function smsStatusCallbackUrl(associationId: string): string {
  return `${APP_URL}/api/webhook/twilio/${associationId}`
}

async function logSmsMessage(
  to: string,
  body: string,
  associationId: string,
  context: SmsContext,
  twilioSid: string | null,
  error: { message: string } | null,
) {
  try {
    await prisma.smsMessage.create({
      data: {
        associationId,
        membreId:     context.membreId,
        source:       context.source,
        sourceId:     context.sourceId,
        to,
        body,
        twilioSid:    twilioSid ?? undefined,
        status:       error ? "FAILED" : "SENT",
        errorMessage: error?.message,
        sentAt:       new Date(),
      },
    })
  } catch (err: unknown) {
    console.error("[sms] failed to log SmsMessage:", err)
  }
}

// Returns the Twilio message SID so the webhook can later match a status callback back to
// this send — throws SmsSendError (with a French reason) on any Twilio API rejection.
async function sendWithCredentials(creds: Credentials, to: string, body: string, statusCallback: string): Promise<string> {
  try {
    const message = await twilio(creds.smsAccountSid, creds.smsAuthToken).messages.create({
      from: creds.smsPhoneNumber, to, body, statusCallback,
    })
    return message.sid
  } catch (err) {
    console.warn("[sms] sendSms failed:", err)
    throw new SmsSendError(twilioErrorReason(err))
  }
}

export async function sendSms(to: string, body: string, associationId: string, context: SmsContext): Promise<void> {
  let creds: Credentials
  try {
    creds = await getCredentials(associationId)
  } catch (err) {
    const message = err instanceof SmsSendError ? err.message : "Échec de l'envoi du SMS."
    await logSmsMessage(to, body, associationId, context, null, { message })
    throw err
  }

  try {
    const sid = await sendWithCredentials(creds, to, body, smsStatusCallbackUrl(associationId))
    await logSmsMessage(to, body, associationId, context, sid, null)
  } catch (err) {
    const message = err instanceof SmsSendError ? err.message : "Échec de l'envoi du SMS."
    await logSmsMessage(to, body, associationId, context, null, { message })
    throw err
  }
}

// One entry per input job, same order — mirrors sendEmailBatch's BatchItemResult so callers
// can tell exactly which recipients failed and why.
export type SmsBatchItemResult = { to: string; ok: boolean; reason?: string }
export type SmsBatchJob = { to: string; body: string; membreId?: string }

// Sends one job and logs its row immediately after — deliberately not batched into a single
// createMany at the end of the whole array. With dozens/hundreds of jobs going out in
// parallel, batching the write until every job settles leaves an early job's row unwritten
// for as long as the slowest job in the batch takes, and Twilio's status callback for that
// early job can arrive well within that window — landing on a row that doesn't exist yet,
// with no retry-window logic here (unlike the Resend webhook) to paper over it. Writing
// per-job keeps the same tight timing as the single-send sendSms() above, which this
// module's webhook-race assumptions are actually built around.
async function sendAndLogOne(
  creds: Credentials,
  job: SmsBatchJob,
  associationId: string,
  context: { source: string; sourceId?: string },
  statusCallback: string,
): Promise<SmsBatchItemResult> {
  try {
    const sid = await sendWithCredentials(creds, job.to, job.body, statusCallback)
    await logSmsMessage(job.to, job.body, associationId, { membreId: job.membreId, ...context }, sid, null)
    return { to: job.to, ok: true }
  } catch (err) {
    const message = err instanceof SmsSendError ? err.message : "Échec de l'envoi du SMS."
    await logSmsMessage(job.to, job.body, associationId, { membreId: job.membreId, ...context }, null, { message })
    return { to: job.to, ok: false, reason: message }
  }
}

export async function sendSmsBatch(
  jobs: SmsBatchJob[],
  associationId: string,
  context: { source: string; sourceId?: string },
): Promise<SmsBatchItemResult[]> {
  if (jobs.length === 0) return []

  let creds: Credentials
  try {
    creds = await getCredentials(associationId)
  } catch (err) {
    const reason = err instanceof SmsSendError ? err.message : "Échec de l'envoi du SMS."
    await prisma.smsMessage.createMany({
      data: jobs.map(j => ({
        associationId, membreId: j.membreId, source: context.source, sourceId: context.sourceId,
        to: j.to, body: j.body, status: "FAILED" as const, errorMessage: reason, sentAt: new Date(),
      })),
    }).catch((err: unknown) => console.error("[sms] failed to log SmsMessage batch:", err))
    return jobs.map(j => ({ to: j.to, ok: false, reason }))
  }

  // No credentials to fail on here (none of these reach Twilio), so no write-timing race —
  // createMany above is fine as-is for that path.
  const statusCallback = smsStatusCallbackUrl(associationId)
  return Promise.all(jobs.map(j => sendAndLogOne(creds, j, associationId, context, statusCallback)))
}
