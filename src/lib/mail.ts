import { Resend } from "resend"
import { APP_NAME } from "@/config/brand"
import { prisma } from "@/lib/prisma/client"

export const resend = new Resend(process.env.RESEND_API_KEY)

export function getFrom(): string {
  return process.env.RESEND_FROM_EMAIL ?? `${APP_NAME} <onboarding@resend.dev>`
}

const DEV_TO = "hello@1367studio.com"
const BATCH_SIZE = 100

// Attached to a send when the recipient resolves to a Membre, so the Resend webhook
// (src/app/api/webhook/resend/route.ts) can later match delivery/open/bounce events back
// to a row and the Membre/portal email histories can query by membreId.
export type EmailContext = {
  associationId: string
  membreId?: string
  source:        string
  sourceId?:     string
}

type Attachment = { filename: string; content: Buffer }
type EmailPayload = { to: string; subject: string; html: string; attachments?: Attachment[] }

async function logEmailMessage(
  payload: { to: string; subject: string; html: string; attachments?: Attachment[] },
  context: EmailContext,
  resendId: string | null,
  error: { message: string } | null,
) {
  try {
    await prisma.emailMessage.create({
      data: {
        associationId: context.associationId,
        membreId:      context.membreId,
        source:        context.source,
        sourceId:      context.sourceId,
        to:            payload.to,
        subject:       payload.subject,
        html:          payload.html,
        hasAttachments: !!payload.attachments?.length,
        resendId:      resendId ?? undefined,
        status:        error ? "FAILED" : "SENT",
        errorMessage:  error?.message,
        sentAt:        new Date(),
      },
    })
  } catch (err: unknown) {
    console.error("[mail] failed to log EmailMessage:", err)
  }
}

export async function sendEmail(payload: EmailPayload, context?: EmailContext): Promise<void> {
  const isDev = process.env.NODE_ENV !== "production"
  const to    = isDev ? DEV_TO : payload.to

  const { data, error } = await resend.emails.send({
    from:        getFrom(),
    to,
    subject:     isDev ? `[DEV → ${payload.to}] ${payload.subject}` : payload.subject,
    html:        payload.html,
    attachments: payload.attachments,
  })

  if (error) console.error("[mail] Resend error:", error)
  if (context) await logEmailMessage(payload, context, data?.id ?? null, error ?? null)
}

type BulkResult = { sent: number; failed: number; failedRecipients: string[] }

type BatchPayload = Omit<EmailPayload, "attachments"> & { context?: EmailContext }

// One entry per input payload, same order — lets callers know exactly which recipients
// actually went out, since a batch can partially succeed (see sendEmailBatch below).
export type BatchItemResult = { to: string; ok: boolean }

function toResendPayload(p: BatchPayload, isDev: boolean, from: string) {
  return {
    from,
    to:      isDev ? DEV_TO : p.to,
    subject: isDev ? `[DEV → ${p.to}] ${p.subject}` : p.subject,
    html:    p.html,
  }
}

// Sends a single chunk (≤100 emails). Returns one result per payload, in the same order —
// a chunk-level `error` from Resend does not mean every recipient in it failed (see below),
// so callers must not collapse this into a single pass/fail for the whole chunk.
export async function sendEmailBatch(payloads: BatchPayload[]): Promise<BatchItemResult[]> {
  const isDev = process.env.NODE_ENV !== "production"
  const from  = getFrom()
  const { data, error } = await resend.batch.send(payloads.map(p => toResendPayload(p, isDev, from)))

  if (error) console.error("[mail] Resend batch error:", error)

  // Resend returns one { id } per email, in the same order as the input array — used to
  // correlate each recipient's context back to its own row (a failed chunk has no ids, so
  // every payload with a context still gets logged, just without a resendId to match webhooks on).
  const ids = data?.data ?? []
  const results: BatchItemResult[] = payloads.map((p, i) => ({ to: p.to, ok: !!ids[i]?.id }))

  const rowsToLog = payloads
    .map((p, i) => ({ p, id: ids[i]?.id as string | undefined }))
    .filter(({ p }) => p.context)

  if (rowsToLog.length) {
    await prisma.emailMessage.createMany({
      data: rowsToLog.map(({ p, id }) => ({
        associationId: p.context!.associationId,
        membreId:      p.context!.membreId,
        source:        p.context!.source,
        sourceId:      p.context!.sourceId,
        to:            p.to,
        subject:       p.subject,
        html:          p.html,
        resendId:      id,
        // Judged per-item on whether Resend actually returned an id for it, not on the
        // aggregate `error` — a batch can come back with `error` set while still carrying
        // real ids for the items that did go out, and marking those FAILED would be wrong.
        status:        id ? "SENT" : "FAILED",
        errorMessage:  id ? undefined : (error?.message ?? "Envoi échoué"),
        sentAt:        new Date(),
      })),
    }).catch((err: unknown) => console.error("[mail] failed to log EmailMessage batch:", err))
  }

  return results
}

// Splits into chunks of BATCH_SIZE and sends sequentially, tallying per-recipient outcomes
// (not per-chunk) — a chunk can partially succeed, and treating the whole chunk as failed
// would misreport recipients who actually got a real Resend id as failed.
export async function sendEmailBulk(payloads: BatchPayload[]): Promise<BulkResult> {
  let sent   = 0
  let failed = 0
  const failedRecipients: string[] = []

  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const chunk   = payloads.slice(i, i + BATCH_SIZE)
    const results = await sendEmailBatch(chunk)
    for (const r of results) {
      if (r.ok) {
        sent++
      } else {
        failed++
        failedRecipients.push(r.to)
      }
    }
  }

  return { sent, failed, failedRecipients }
}
