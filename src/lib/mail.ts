import { Resend } from "resend"
import { APP_NAME } from "@/config/brand"
import { prisma } from "@/lib/prisma/client"

export const resend = new Resend(process.env.RESEND_API_KEY)

// The technical sending address stays a fixed Formwise address (RESEND_FROM_EMAIL, e.g.
// "Formwise <noreply@formwise.fr>") — only the display name in front of it varies. Accepts
// either that full "Name <email>" form or a bare address (as in .env.example) so both
// formats keep working.
function resolveFromAddress(): string {
  const raw = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev"
  return raw.match(/<([^>]+)>/)?.[1] ?? raw
}

// RFC 5322 display-name quoting: strip characters that would break out of the header
// (CR/LF, quotes, angle brackets) rather than trying to escape them, since a stray "<"/">"
// in an association's name could otherwise be read as a second address.
function formatFromHeader(displayName: string, address: string): string {
  const cleaned = displayName.replace(/[\r\n"<>]/g, "").trim()
  return cleaned ? `"${cleaned}" <${address}>` : address
}

// Called with an association's name for association-owned emails (membership, dons,
// events, portal messages, ...) — anything without a name (platform account/security/
// billing/support emails) falls back to the Formwise identity from RESEND_FROM_EMAIL.
export function getFrom(fromName?: string): string {
  if (!fromName) return process.env.RESEND_FROM_EMAIL ?? `${APP_NAME} <onboarding@resend.dev>`
  return formatFromHeader(fromName, resolveFromAddress())
}

const DEV_TO = "hello@1367studio.com"
const BATCH_SIZE = 100

// Attached to a send when the recipient resolves to a Membre or a User (manager/staff
// account), so the Resend webhook (src/app/api/webhook/resend/route.ts) can later match
// delivery/open/bounce events back to a row and the Membre/portal/manager email histories
// can query by membreId or userId. Also doubles as the source of the Reply-To address
// below: any association-scoped send that carries a context gets Association.contactEmail
// as Reply-To for free, with no per-call-site plumbing needed.
export type EmailContext = {
  associationId: string
  membreId?: string
  userId?:   string
  source:        string
  sourceId?:     string
}

// Most callers already fetched the Association row seconds earlier (for `associationName`)
// — this cache avoids paying for a second lookup on every single transactional send just to
// get contactEmail. Module-level, so it also survives across requests on a warm serverless
// instance (Fluid Compute reuses instances), not just within one. A short TTL bounds how
// stale a Reply-To can get after an admin edits it — an email sent in that window still goes
// out under the old address, which is an acceptable trade for cutting the query volume.
const CONTACT_EMAIL_CACHE_TTL_MS = 30_000
const contactEmailCache = new Map<string, { value: string | undefined; expiresAt: number }>()

async function getAssociationContactEmail(associationId: string): Promise<string | undefined> {
  const cached = contactEmailCache.get(associationId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let value: string | undefined
  try {
    const association = await prisma.association.findUnique({ where: { id: associationId }, select: { contactEmail: true } })
    value = association?.contactEmail ?? undefined
  } catch (err: unknown) {
    console.error("[mail] failed to resolve association contactEmail:", err)
    value = undefined
  }
  contactEmailCache.set(associationId, { value, expiresAt: Date.now() + CONTACT_EMAIL_CACHE_TTL_MS })
  return value
}

// Resolves the Reply-To address for an association-owned send. `explicit` wins when a
// caller already has a more specific contact email in scope (e.g. a DonationForm's own
// contactEmail) — falls back to the association's general contactEmail otherwise, and to
// no Reply-To at all when neither is set (mail then just replies to the technical address).
async function resolveReplyTo(explicit: string | undefined, associationId: string | undefined): Promise<string | undefined> {
  if (explicit) return explicit
  if (!associationId) return undefined
  return getAssociationContactEmail(associationId)
}

type Attachment = { filename: string; content: Buffer }
type EmailPayload = {
  to: string
  subject: string
  html: string
  attachments?: Attachment[]
  // Association display name for the "From" header — omit for Formwise-platform emails.
  fromName?: string
  // Explicit Reply-To override (e.g. a form's own contact email); when omitted, an
  // association-scoped `context` still yields a Reply-To via resolveReplyTo() above.
  replyTo?: string
}

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
  const isDev  = process.env.NODE_ENV !== "production"
  const to     = isDev ? DEV_TO : payload.to
  const replyTo = await resolveReplyTo(payload.replyTo, context?.associationId)

  const { data, error } = await resend.emails.send({
    from:        getFrom(payload.fromName),
    to,
    replyTo,
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

// Batches are usually all the same association, but each payload resolves its own
// from/replyTo independently — `replyToMap` (association id → contactEmail) lets that stay
// a plain lookup instead of a query per recipient.
function toResendPayload(p: BatchPayload, isDev: boolean, replyToMap: Map<string, string | undefined>) {
  return {
    from:    getFrom(p.fromName),
    to:      isDev ? DEV_TO : p.to,
    replyTo: p.replyTo ?? (p.context ? replyToMap.get(p.context.associationId) : undefined),
    subject: isDev ? `[DEV → ${p.to}] ${p.subject}` : p.subject,
    html:    p.html,
  }
}

// A batch is virtually always a single association (a bulk send to one association's
// members), so this is normally one cached-or-fresh lookup, not a findMany — routing it
// through getAssociationContactEmail keeps single-send and batch sends sharing the same
// cache instead of the batch path always re-querying.
async function buildReplyToMap(payloads: BatchPayload[]): Promise<Map<string, string | undefined>> {
  const associationIds = [...new Set(
    payloads.map(p => p.context?.associationId).filter((id): id is string => !!id),
  )]
  if (!associationIds.length) return new Map()
  const entries = await Promise.all(
    associationIds.map(async (id): Promise<[string, string | undefined]> => [id, await getAssociationContactEmail(id)]),
  )
  return new Map(entries)
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

async function sendIndividually(payloads: BatchPayload[], isDev: boolean, replyToMap: Map<string, string | undefined>): Promise<SendItem[]> {
  const results: SendItem[] = new Array(payloads.length)
  let cursor = 0
  async function worker() {
    while (cursor < payloads.length) {
      const i = cursor++
      results[i] = await Promise.race([
        resend.emails.send(toResendPayload(payloads[i], isDev, replyToMap))
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
  const replyToMap = await buildReplyToMap(payloads)
  const { data, error } = await resend.batch.send(payloads.map(p => toResendPayload(p, isDev, replyToMap)))

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
      const retried = await sendIndividually(missing.map(i => payloads[i]), isDev, replyToMap)
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
