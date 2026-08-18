import { Resend } from "resend"
import { APP_NAME } from "@/config/brand"
import { prisma } from "@/lib/prisma/client"

export const resend = new Resend(process.env.RESEND_API_KEY)

export function getFrom(): string {
  return process.env.RESEND_FROM_EMAIL ?? `${APP_NAME} <onboarding@resend.dev>`
}

const DEV_TO = "hello@1367studio.com"
const BATCH_SIZE = 100

// Attached to a send when the recipient resolves to a Membre or a User (manager/staff
// account), so the Resend webhook (src/app/api/webhook/resend/route.ts) can later match
// delivery/open/bounce events back to a row and the Membre/portal/manager email histories
// can query by membreId or userId.
export type EmailContext = {
  associationId: string
  membreId?: string
  userId?:   string
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
        userId:        context.userId,
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
type SendItem = { id?: string; error?: { message: string } | null }

// Caps how many individual retries run at once, and how long each may take — a validation
// failure can affect up to a whole chunk (100), and firing all of them at once would risk
// tripping Resend's own rate limit (turning rescuable recipients into new failures) and
// letting one stalled request hold up every other result indefinitely.
const INDIVIDUAL_RETRY_CONCURRENCY = 5
const INDIVIDUAL_RETRY_TIMEOUT_MS  = 15_000

async function sendIndividually(payloads: BatchPayload[], isDev: boolean, from: string): Promise<SendItem[]> {
  const results: SendItem[] = new Array(payloads.length)
  let cursor = 0
  async function worker() {
    while (cursor < payloads.length) {
      const i = cursor++
      results[i] = await Promise.race([
        resend.emails.send(toResendPayload(payloads[i], isDev, from))
          .then((r): SendItem => ({ id: r.data?.id, error: r.error ? { message: r.error.message } : null }))
          .catch((e: unknown): SendItem => ({ error: { message: e instanceof Error ? e.message : "Erreur d'envoi" } })),
        new Promise<SendItem>(resolve =>
          setTimeout(() => resolve({ error: { message: "Délai d'envoi dépassé" } }), INDIVIDUAL_RETRY_TIMEOUT_MS)),
      ])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(INDIVIDUAL_RETRY_CONCURRENCY, payloads.length) }, worker),
  )
  return results
}

export async function sendEmailBatch(payloads: BatchPayload[]): Promise<BatchItemResult[]> {
  const isDev = process.env.NODE_ENV !== "production"
  const from  = getFrom()
  const { data, error } = await resend.batch.send(payloads.map(p => toResendPayload(p, isDev, from)))

  // Start from whatever ids the batch call actually returned — Resend can return `error`
  // while `data.data` still carries real ids for the items that did go out (a partial-
  // success shape), so indexing by id here (not by the aggregate `error`) is what avoids
  // reporting those as failed below.
  const items: SendItem[] = payloads.map((_, i) => ({ id: data?.data?.[i]?.id }))

  if (error) {
    const missing = payloads.map((_, i) => i).filter(i => !items[i].id)
    // Only retry per-recipient on a validation error (422) — the shape Resend uses for a
    // bad "to" field (e.g. a placeholder like someone@example.com from manually-entered
    // guest data). Any other error (bad auth, rate limit, outage) applies to the whole
    // request equally, so resending each recipient one by one would just fail the same
    // way N times over instead of once.
    if (error.statusCode === 422 && missing.length) {
      console.error("[mail] Resend batch validation error, retrying recipients individually:", error)
      const retried = await sendIndividually(missing.map(i => payloads[i]), isDev, from)
      missing.forEach((i, k) => { items[i] = retried[k] })
    } else {
      console.error("[mail] Resend batch error:", error)
      missing.forEach(i => { items[i] = { error: { message: error.message } } })
    }
  }

  const results: BatchItemResult[] = payloads.map((p, i) => ({ to: p.to, ok: !!items[i]?.id }))

  const rowsToLog = payloads
    .map((p, i) => ({ p, item: items[i] as SendItem | undefined }))
    .filter(({ p }) => p.context)

  if (rowsToLog.length) {
    await prisma.emailMessage.createMany({
      data: rowsToLog.map(({ p, item }) => ({
        associationId: p.context!.associationId,
        membreId:      p.context!.membreId,
        userId:        p.context!.userId,
        source:        p.context!.source,
        sourceId:      p.context!.sourceId,
        to:            p.to,
        subject:       p.subject,
        html:          p.html,
        resendId:      item?.id,
        status:        item?.id ? "SENT" : "FAILED",
        errorMessage:  item?.id ? undefined : (item?.error?.message ?? "Envoi échoué"),
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
