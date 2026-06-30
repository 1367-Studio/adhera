import twilio from "twilio"

export class SmsSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SmsSendError"
  }
}

function getClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new SmsSendError("Twilio non configuré.")
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
}

export async function sendSms(to: string, body: string): Promise<void> {
  try {
    await getClient().messages.create({ from: process.env.TWILIO_PHONE_NUMBER!, to, body })
  } catch (err) {
    console.warn("[sms] sendSms failed:", err)
    throw new SmsSendError("Échec de l'envoi du SMS.")
  }
}

export async function sendSmsBatch(
  jobs: { to: string; body: string }[],
): Promise<{ sent: number; failed: number }> {
  if (jobs.length === 0) return { sent: 0, failed: 0 }
  const results = await Promise.allSettled(jobs.map(j => sendSms(j.to, j.body)))
  return {
    sent:   results.filter(r => r.status === "fulfilled").length,
    failed: results.filter(r => r.status === "rejected").length,
  }
}
