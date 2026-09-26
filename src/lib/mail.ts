import { createHash } from "crypto"
import { Resend, type CreateEmailOptions, type ErrorResponse } from "resend"
import { APP_NAME } from "@/config/brand"
import { prisma } from "@/lib/prisma/client"
import { reportError } from "@/lib/monitoring"

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
  } catch (error: unknown) {
    reportError(error, { area: "email", action: "mail.resolve-contact-email", extra: { associationId } })
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
  } catch (error: unknown) {
    reportError(error, { area: "email", action: "mail.log-message", extra: { associationId: context.associationId, source: context.source, sourceId: context.sourceId } })
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

  if (error) {
    // 422 = a bad recipient address (member data), not a sending outage — logged only.
    if (error.statusCode === 422) console.error("[mail] Resend validation error:", error)
    else reportResendError(error, "mail.resend-send", context?.associationId)
  }
  if (context) await logEmailMessage(payload, context, data?.id ?? null, error ?? null)
}

// Resend returns failures instead of throwing, so Sentry never sees them on its own: a bad
// API key, a rate limit or an outage silently leaves members without their email.
function reportResendError(error: ErrorResponse, action: string, associationId: string | undefined) {
  reportError(new Error(`Resend ${error.name}: ${error.message}`), {
    area:   "email",
    action,
    extra:  { associationId, statusCode: error.statusCode },
  })
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
      reportResendError(error, "mail.resend-batch", payloads[0]?.context?.associationId)
      missing.forEach(i => { items[i] = { error: { message: error.message } } })
    }
  }

  const results: BatchItemResult[] = payloads.map((p, i) => ({ to: p.to, ok: !!items[i]?.id }))

  await logEmailMessageBatch(payloads, items, { hasAttachments: false })

  return results
}

// One EmailMessage row per payload that carries a context, `items` matching `payloads` by
// index — shared by the batch path above and the per-recipient attachment path below, so a
// send shows up identically in the membre/portal/manager email histories either way.
async function logEmailMessageBatch(payloads: BatchPayload[], items: (SendItem | undefined)[], options: { hasAttachments: boolean }) {
  const rowsToLog = payloads
    .map((payload, index) => ({ payload, item: items[index] }))
    .filter(({ payload }) => payload.context)
  if (!rowsToLog.length) return

  await prisma.emailMessage.createMany({
    data: rowsToLog.map(({ payload, item }) => ({
      associationId:  payload.context!.associationId,
      membreId:       payload.context!.membreId,
      userId:         payload.context!.userId,
      source:         payload.context!.source,
      sourceId:       payload.context!.sourceId,
      to:             payload.to,
      subject:        payload.subject,
      html:           payload.html,
      hasAttachments: options.hasAttachments,
      resendId:       item?.id,
      status:         item?.id ? "SENT" : "FAILED",
      errorMessage:   item?.id ? undefined : (item?.error?.message ?? "Envoi échoué"),
      sentAt:         new Date(),
    })),
  }).catch((error: unknown) => reportError(error, { area: "email", action: "mail.log-message-batch", extra: { associationId: rowsToLog[0]?.payload.context?.associationId, count: rowsToLog.length } }))
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

// ── Per-recipient sends with attachments ──────────────────────────────────────

// A bulk email's attachments, referenced by public URL rather than carried as bytes: Resend
// fetches each `path` itself, so a 4 MB attachment never passes through our function, nor
// through the Inngest event/step state these travel in.
export type EmailUrlAttachment = { url: string; filename: string; contentType: string }

// Resend's batch endpoint doesn't accept attachments at all, so these go out as one
// emails.send per recipient — each counting against Resend's per-team rate limit (2 requests/
// second by default), which every other email the app sends at that moment shares. Starting
// requests ~700 ms apart (~1.4/s) leaves that concurrent traffic some headroom instead of
// relying on 429 retries to absorb it.
const ATTACHMENT_SEND_INTERVAL_MS = 700
// A 429 is retried after 1 s, 2 s, then 4 s (or Resend's own Retry-After, when longer) — a
// limit still hit after that points to sustained contention, and every retry delays the rest
// of the recipients queued behind this one.
const RATE_LIMIT_MAX_ATTEMPTS    = 4
const RATE_LIMIT_BASE_BACKOFF_MS = 1_000
const RATE_LIMIT_MAX_BACKOFF_MS  = 10_000
// Twice INDIVIDUAL_RETRY_TIMEOUT_MS: Resend may fetch every attachment (up to 4 MB in total)
// while handling the request, so a legitimately slow send takes longer than a plain one.
const ATTACHMENT_SEND_TIMEOUT_MS = 30_000

function sleep(durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationMs))
}

// Spaces request *starts* at least `intervalMs` apart — retries included, so a 429 retry
// followed straight away by the next recipient's first attempt can't burst past the pacing.
function createRequestPacer(intervalMs: number): () => Promise<void> {
  let lastRequestStartedAt = 0
  return async function waitForTurn() {
    const waitMs = lastRequestStartedAt + intervalMs - Date.now()
    if (waitMs > 0) await sleep(waitMs)
    lastRequestStartedAt = Date.now()
  }
}

// Resend answers 429 both for its per-second rate limit (worth retrying shortly) and for an
// exhausted daily/monthly quota (not worth retrying at all) — only the former is retried.
function isRateLimitError(error: ErrorResponse): boolean {
  if (error.name === "daily_quota_exceeded" || error.name === "monthly_quota_exceeded") return false
  return error.name === "rate_limit_exceeded" || error.statusCode === 429
}

function parseRetryAfterMs(headers: Record<string, string> | null): number | undefined {
  const retryAfterSeconds = Number(headers?.["retry-after"])
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1_000 : undefined
}

// Scoped to the send job and the recipient: an Inngest retry of a step then re-sends nothing
// that already went out (Resend replays the original response for a known key), while two
// members sharing one address (e.g. a family email) still each get their own personalized
// copy instead of the second being rejected as a conflicting replay of the first. Hashed
// because Resend caps keys at 256 characters and an address alone can come close to that.
function buildIdempotencyKey(prefix: string, payload: BatchPayload): string {
  const recipientIdentity = `${payload.context?.membreId ?? ""}|${payload.to.toLowerCase()}`
  return `${prefix}:${createHash("sha256").update(recipientIdentity).digest("hex").slice(0, 32)}`
}

type AttachmentSendAttempt = { item: SendItem; rateLimited: boolean; retryAfterMs?: number }

async function attemptSendWithTimeout(resendPayload: CreateEmailOptions, idempotencyKey: string): Promise<AttachmentSendAttempt> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<AttachmentSendAttempt>(resolve => {
    timeoutHandle = setTimeout(
      () => resolve({ item: { error: { message: "Délai d'envoi dépassé" } }, rateLimited: false }),
      ATTACHMENT_SEND_TIMEOUT_MS,
    )
  })
  const request = resend.emails.send(resendPayload, { idempotencyKey })
    .then((response): AttachmentSendAttempt => {
      if (!response.error) return { item: { id: response.data.id, error: null }, rateLimited: false }
      return {
        item:         { error: { message: response.error.message } },
        rateLimited:  isRateLimitError(response.error),
        retryAfterMs: parseRetryAfterMs(response.headers),
      }
    })
    .catch((error: unknown): AttachmentSendAttempt => ({
      item:        { error: { message: error instanceof Error ? error.message : "Erreur d'envoi" } },
      rateLimited: false,
    }))

  try {
    return await Promise.race([request, timeout])
  } finally {
    clearTimeout(timeoutHandle)
  }
}

// Retries only a rate-limit rejection — any other error (invalid address, bad attachment,
// quota) would fail the same way again, so that recipient is simply reported as failed.
async function sendWithRateLimitRetry(
  resendPayload:  CreateEmailOptions,
  idempotencyKey: string,
  waitForTurn:    () => Promise<void>,
): Promise<SendItem> {
  for (let attempt = 1; ; attempt++) {
    await waitForTurn()
    const outcome = await attemptSendWithTimeout(resendPayload, idempotencyKey)
    if (!outcome.rateLimited || attempt >= RATE_LIMIT_MAX_ATTEMPTS) return outcome.item

    const exponentialBackoffMs = RATE_LIMIT_BASE_BACKOFF_MS * 2 ** (attempt - 1)
    await sleep(Math.min(Math.max(exponentialBackoffMs, outcome.retryAfterMs ?? 0), RATE_LIMIT_MAX_BACKOFF_MS))
  }
}

// Same contract as sendEmailBatch (one result per payload, same order, same EmailMessage
// logging), for sends carrying attachments — which the batch endpoint can't take. Sequential
// on purpose, unlike sendIndividually's small worker pool: pacing under Resend's rate limit is
// the whole point here. `idempotencyKeyPrefix` must be stable across retries of the same send
// (e.g. the bulk job's id), which is what makes re-running a partially sent chunk safe.
export async function sendEmailsWithAttachments(
  payloads:    BatchPayload[],
  attachments: EmailUrlAttachment[],
  options:     { idempotencyKeyPrefix: string },
): Promise<BatchItemResult[]> {
  const isDev       = process.env.NODE_ENV !== "production"
  const replyToMap  = await buildReplyToMap(payloads)
  const waitForTurn = createRequestPacer(ATTACHMENT_SEND_INTERVAL_MS)
  const resendAttachments = attachments.map(attachment => ({
    filename:    attachment.filename,
    path:        attachment.url,
    contentType: attachment.contentType,
  }))

  const items: SendItem[] = []
  for (const payload of payloads) {
    const item = await sendWithRateLimitRetry(
      { ...toResendPayload(payload, isDev, replyToMap), attachments: resendAttachments },
      buildIdempotencyKey(options.idempotencyKeyPrefix, payload),
      waitForTurn,
    )
    if (!item.id) console.error("[mail] Resend error (send with attachments):", item.error?.message)
    items.push(item)
  }

  await logEmailMessageBatch(payloads, items, { hasAttachments: true })

  return payloads.map((payload, index) => ({ to: payload.to, ok: !!items[index].id }))
}
