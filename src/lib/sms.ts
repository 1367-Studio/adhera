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

async function sendWithCredentials(creds: Credentials, to: string, body: string): Promise<void> {
  try {
    await twilio(creds.smsAccountSid, creds.smsAuthToken).messages.create({ from: creds.smsPhoneNumber, to, body })
  } catch (err) {
    console.warn("[sms] sendSms failed:", err)
    throw new SmsSendError("Échec de l'envoi du SMS.")
  }
}

export async function sendSms(to: string, body: string, associationId: string): Promise<void> {
  const creds = await getCredentials(associationId)
  await sendWithCredentials(creds, to, body)
}

export async function sendSmsBatch(
  jobs: { to: string; body: string }[],
  associationId: string,
): Promise<boolean[]> {
  if (jobs.length === 0) return []

  let creds: Credentials
  try {
    creds = await getCredentials(associationId)
  } catch {
    return jobs.map(() => false)
  }

  const results = await Promise.allSettled(jobs.map(j => sendWithCredentials(creds, j.to, j.body)))
  return results.map(r => r.status === "fulfilled")
}
