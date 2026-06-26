import { Resend } from "resend"

export const resend = new Resend(process.env.RESEND_API_KEY)

export function getFrom(): string {
  return process.env.RESEND_FROM_EMAIL ?? "Adhéra <onboarding@resend.dev>"
}

const DEV_TO = "hello@1367studio.com"

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
