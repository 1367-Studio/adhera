import { NextResponse } from "next/server"
import { resend } from "@/lib/mail"
import { prisma } from "@/lib/prisma/client"
import type { WebhookEventPayload } from "resend"
import type { EmailStatus } from "@prisma/client"

export const dynamic = "force-dynamic"

// Resend delivers events at-least-once and does not guarantee order, so a status is only
// ever moved "forward". DELAYED sits at the same tier as SENT (not DELIVERED) — a delayed
// notice is strictly weaker news than "delivered", so a late/out-of-order delivery_delayed
// event landing after delivered must never regress the row back to "Retardé".
const STATUS_PRIORITY: Record<EmailStatus, number> = {
  QUEUED:     0,
  SENT:       1,
  DELAYED:    1,
  DELIVERED:  2,
  OPENED:     3,
  CLICKED:    4,
  BOUNCED:    5,
  COMPLAINED: 5,
  FAILED:     5,
}

const EVENT_STATUS: Partial<Record<WebhookEventPayload["type"], EmailStatus>> = {
  "email.delivered":        "DELIVERED",
  "email.delivery_delayed": "DELAYED",
  "email.opened":           "OPENED",
  "email.clicked":          "CLICKED",
  "email.bounced":          "BOUNCED",
  "email.complained":       "COMPLAINED",
  "email.failed":           "FAILED",
}

const TIMESTAMP_FIELD: Partial<Record<EmailStatus, "deliveredAt" | "openedAt" | "clickedAt" | "bouncedAt" | "complainedAt">> = {
  DELIVERED:  "deliveredAt",
  OPENED:     "openedAt",
  CLICKED:    "clickedAt",
  BOUNCED:    "bouncedAt",
  COMPLAINED: "complainedAt",
}

// How long to ask Resend/Svix to keep retrying an event whose EmailMessage row isn't found
// yet — covers the gap between Resend accepting a send (and being able to fire a webhook
// almost immediately) and our own INSERT committing. Past this window, "not found" is taken
// to mean the send was never tracked at all (e.g. password reset), not a timing issue.
const RETRY_WINDOW_MS = 2 * 60 * 1000

export async function POST(req: Request) {
  const payload = await req.text()

  let event: WebhookEventPayload
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id:        req.headers.get("svix-id") ?? "",
        timestamp: req.headers.get("svix-timestamp") ?? "",
        signature: req.headers.get("svix-signature") ?? "",
      },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
    })
  } catch (err) {
    // Almost always a wrong/missing RESEND_WEBHOOK_SECRET for this environment — that
    // failure mode is otherwise completely silent (every event just 400s forever with
    // nothing surfaced in the app), so this log line is the only way to notice it.
    console.error("[webhook/resend] signature verification failed — check RESEND_WEBHOOK_SECRET:", err)
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 })
  }

  const newStatus = EVENT_STATUS[event.type]
  if (!newStatus) return NextResponse.json({ received: true })

  // EVENT_STATUS only has keys for the email.* variants, all of which share
  // BaseEmailEventData — safe to narrow here even though the union type itself doesn't.
  const emailId = (event.data as { email_id: string }).email_id
  const existing = await prisma.emailMessage.findUnique({ where: { resendId: emailId } })

  if (!existing) {
    const eventAge = Date.now() - new Date(event.created_at).getTime()
    if (eventAge < RETRY_WINDOW_MS) {
      // Our own EmailMessage insert may not have committed yet — a 200 here would mean
      // Resend/Svix never retries and this event is lost for good, so ask for a retry instead.
      return NextResponse.json({ error: "Not yet tracked" }, { status: 404 })
    }
    // Old enough that this is genuinely an untracked send (e.g. password reset) — stop retries.
    return NextResponse.json({ received: true })
  }

  if (STATUS_PRIORITY[newStatus] < STATUS_PRIORITY[existing.status]) return NextResponse.json({ received: true })

  const timestampField = TIMESTAMP_FIELD[newStatus]
  const errorMessage =
    event.type === "email.bounced" ? event.data.bounce.message :
    event.type === "email.failed"  ? event.data.failed.reason :
    undefined

  await prisma.emailMessage.update({
    where: { id: existing.id },
    data: {
      status: newStatus,
      // Use the event's own timestamp, not "now" — a redelivered duplicate of the same
      // event (Resend guarantees at-least-once, so this happens) would otherwise push
      // e.g. openedAt forward on every redelivery instead of staying put.
      ...(timestampField ? { [timestampField]: new Date(event.created_at) } : {}),
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    },
  })

  return NextResponse.json({ received: true })
}
