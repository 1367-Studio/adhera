import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { sendEmailBulk } from "@/lib/mail"
import { eventReminderEmail } from "@/lib/email"
import { sendSms, eventReminderSms } from "@/lib/sms"
import { parseSmsSettings } from "@/lib/sms-settings"

export async function GET(req: Request) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "")
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now      = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0)
  const dayEnd   = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59)

  const evenements = await prisma.evenement.findMany({
    where: { date: { gte: dayStart, lte: dayEnd } },
    include: {
      association:    { select: { name: true, slug: true, smsSettings: true } },
      participations: {
        where:   { rsvp: { in: ["CONFIRME", "PROVAVEL"] } },
        include: { membre: { select: { firstName: true, email: true, phone: true } } },
      },
    },
  })

  const portalUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/portal`

  const payloads = evenements.flatMap(ev =>
    ev.participations
      .filter(p => p.membre.email)
      .map(p => eventReminderEmail({
        firstName:       p.membre.firstName,
        email:           p.membre.email!,
        associationName: ev.association.name,
        eventTitle:      ev.title,
        eventDate:       ev.date,
        eventLocation:   ev.location,
        portalUrl,
      }))
  )

  const { sent, failed } = await sendEmailBulk(payloads)

  const smsJobs = evenements.flatMap(ev => {
    const smsConfig = parseSmsSettings(ev.association.smsSettings)
    if (!smsConfig.eventReminder) return []
    return ev.participations
      .filter(p => p.membre.phone)
      .map(p => sendSms(p.membre.phone!, eventReminderSms({
        firstName:       p.membre.firstName,
        associationName: ev.association.name,
        eventTitle:      ev.title,
        eventDate:       ev.date,
      })))
  })
  const smsResults  = await Promise.allSettled(smsJobs)
  const smsSent     = smsResults.filter(r => r.status === "fulfilled").length
  const smsFailed   = smsResults.filter(r => r.status === "rejected").length

  return NextResponse.json({ ok: true, sent, failed, smsSent, smsFailed })
}
