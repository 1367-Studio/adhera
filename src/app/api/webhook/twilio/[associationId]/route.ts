import { NextResponse } from "next/server"
import twilio from "twilio"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { twilioErrorReasonForCode } from "@/lib/sms"
import type { SmsStatus } from "@prisma/client"

export const dynamic = "force-dynamic"

// Twilio delivers status callbacks at-least-once and not necessarily in order — a status
// only ever moves "forward". UNDELIVERED/FAILED sit at the same terminal tier so a late
// duplicate of one never regresses a row already marked with the other.
const STATUS_PRIORITY: Record<SmsStatus, number> = {
  QUEUED:      0,
  SENDING:     1,
  SENT:        2,
  DELIVERED:   3,
  UNDELIVERED: 3,
  FAILED:      3,
}

const STATUS_MAP: Record<string, SmsStatus> = {
  queued:      "QUEUED",
  sending:     "SENDING",
  sent:        "SENT",
  delivered:   "DELIVERED",
  undelivered: "UNDELIVERED",
  failed:      "FAILED",
}

const TIMESTAMP_FIELD: Partial<Record<SmsStatus, "sentAt" | "deliveredAt" | "failedAt">> = {
  SENT:        "sentAt",
  DELIVERED:   "deliveredAt",
  UNDELIVERED: "failedAt",
  FAILED:      "failedAt",
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ associationId: string }> },
) {
  const { associationId } = await params

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { smsAuthToken: true },
  })
  if (!assoc?.smsAuthToken) {
    return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
  }

  const formData     = await req.formData()
  const twilioParams = Object.fromEntries(formData.entries()) as Record<string, string>

  // Reconstructed deterministically rather than read from req.url — this app runs behind
  // a reverse proxy that can rewrite the host/protocol before the handler sees it, but
  // validateRequest needs an exact match against the public URL Twilio actually POSTed
  // to (the same one passed as `statusCallback` at send time in src/lib/sms.ts).
  const expectedUrl = `${APP_URL}/api/webhook/twilio/${associationId}`
  const signature    = req.headers.get("x-twilio-signature") ?? ""

  if (!twilio.validateRequest(assoc.smsAuthToken, signature, expectedUrl, twilioParams)) {
    console.error("[webhook/twilio] signature verification failed for association", associationId)
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 })
  }

  const newStatus = STATUS_MAP[twilioParams.MessageStatus ?? ""]
  if (!newStatus || !twilioParams.MessageSid) return NextResponse.json({ received: true })

  const existing = await prisma.smsMessage.findUnique({ where: { twilioSid: twilioParams.MessageSid } })

  // Unlike the Resend webhook, there's no "not committed yet" race to retry for: the
  // SmsMessage row is written synchronously (awaited) inside sendSms()/sendSmsBatch()
  // right after Twilio's create() call resolves, well before Twilio's own async status
  // callback can possibly fire. "Not found" here just means a stale/unknown sid.
  if (!existing || existing.associationId !== associationId) {
    return NextResponse.json({ error: "Message introuvable" }, { status: 404 })
  }

  // Twilio delivers at-least-once, so the exact same status can arrive twice. Unlike the
  // Resend webhook (which sets timestamps from the event's own created_at, making a
  // redelivered duplicate a no-op automatically), Twilio's callback carries no event
  // timestamp — we'd otherwise stamp `new Date()` again on every duplicate and push the
  // recorded time forward on each redelivery, past when the status actually changed.
  if (newStatus === existing.status) {
    return NextResponse.json({ received: true })
  }

  if (STATUS_PRIORITY[newStatus] < STATUS_PRIORITY[existing.status]) {
    return NextResponse.json({ received: true })
  }

  const timestampField = TIMESTAMP_FIELD[newStatus]
  const errorCode       = twilioParams.ErrorCode ? Number(twilioParams.ErrorCode) : undefined

  await prisma.smsMessage.update({
    where: { id: existing.id },
    data: {
      status: newStatus,
      ...(timestampField ? { [timestampField]: new Date() } : {}),
      ...(errorCode !== undefined ? { errorMessage: twilioErrorReasonForCode(errorCode) } : {}),
    },
  })

  return NextResponse.json({ received: true })
}
