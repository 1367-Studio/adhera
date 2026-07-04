import { Resend } from "resend"

export const resend = new Resend(process.env.RESEND_API_KEY)

export function getFrom(): string {
  return process.env.RESEND_FROM_EMAIL ?? "Adhéra <onboarding@resend.dev>"
}

const DEV_TO = "hello@1367studio.com"
const BATCH_SIZE = 100

type Attachment = { filename: string; content: Buffer }
type EmailPayload = { to: string; subject: string; html: string; attachments?: Attachment[] }

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const isDev = process.env.NODE_ENV !== "production"
  const to    = isDev ? DEV_TO : payload.to

  const { error } = await resend.emails.send({
    from:        getFrom(),
    to,
    subject:     isDev ? `[DEV → ${payload.to}] ${payload.subject}` : payload.subject,
    html:        payload.html,
    attachments: payload.attachments,
  })

  if (error) console.error("[mail] Resend error:", error)
}

type BulkResult = { sent: number; failed: number; failedRecipients: string[] }

type BatchPayload = Omit<EmailPayload, "attachments">

function toResendPayload(p: BatchPayload, isDev: boolean, from: string) {
  return {
    from,
    to:      isDev ? DEV_TO : p.to,
    subject: isDev ? `[DEV → ${p.to}] ${p.subject}` : p.subject,
    html:    p.html,
  }
}

// Sends a single chunk (≤100 emails). Returns whether the batch succeeded.
export async function sendEmailBatch(payloads: BatchPayload[]): Promise<boolean> {
  const isDev = process.env.NODE_ENV !== "production"
  const from  = getFrom()
  const { error } = await resend.batch.send(payloads.map(p => toResendPayload(p, isDev, from)))
  if (error) console.error("[mail] Resend batch error:", error)
  return !error
}

// Splits into chunks of BATCH_SIZE and sends sequentially. Resend's batch API only
// reports success/failure per chunk, not per recipient — a failed chunk means every
// recipient in it (up to BATCH_SIZE) is reported as failed, not necessarily each one individually.
export async function sendEmailBulk(payloads: BatchPayload[]): Promise<BulkResult> {
  let sent   = 0
  let failed = 0
  const failedRecipients: string[] = []

  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const chunk = payloads.slice(i, i + BATCH_SIZE)
    const ok    = await sendEmailBatch(chunk)
    if (ok) {
      sent += chunk.length
    } else {
      failed += chunk.length
      failedRecipients.push(...chunk.map(p => p.to))
    }
  }

  return { sent, failed, failedRecipients }
}
