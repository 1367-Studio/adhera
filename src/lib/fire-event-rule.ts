import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { sendSms } from "@/lib/sms"
import { parseModules } from "@/lib/modules"
import { substituteVars, buildVars } from "@/lib/automation"
import type { MessageChannel, TriggerType } from "@prisma/client"

type EventTrigger = Extract<TriggerType, "RSVP_CONFIRMED" | "MEMBER_CREATED">

interface FireParams {
  triggerType:   EventTrigger
  associationId: string
  association:   { name: string; slug: string; modules: unknown }
  membre:        { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }
  evenement?:    { id: string; title: string; date: Date; location: string | null }
}

export async function fireEventRule(params: FireParams): Promise<boolean> {
  const { triggerType, associationId, association, membre, evenement } = params

  const mods = parseModules(association.modules)
  if (!mods.messages) return false

  const rule = await prisma.automationRule.findFirst({
    where:   { associationId, triggerType, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: { template: true },
  })
  if (!rule || !rule.template.active) return false

  const vars = buildVars({
    prenom:      membre.firstName,
    nom:         membre.lastName,
    email:       membre.email ?? "",
    association: association.name,
    slug:        association.slug,
    titreEvenement: evenement?.title,
    dateEvenement:  evenement?.date
      ? evenement.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
      : undefined,
    lieuEvenement: evenement?.location ?? undefined,
  })

  const channel = rule.channel as MessageChannel
  let dispatched = false

  if ((channel === "EMAIL" || channel === "BOTH") && membre.email) {
    sendEmail({
      to:      membre.email,
      subject: substituteVars(rule.template.subject, vars),
      html:    substituteVars(rule.template.body, vars),
    }).catch(() => {})
    dispatched = true
  }

  if ((channel === "SMS" || channel === "BOTH") && mods.sms && rule.template.smsBody && membre.phone) {
    sendSms(membre.phone, substituteVars(rule.template.smsBody, vars), associationId).catch(() => {})
    dispatched = true
  }

  if (dispatched) {
    await prisma.automationLog.create({
      data: {
        ruleId:   rule.id,
        membreId: membre.id,
        eventId:  evenement?.id,
        subject:  substituteVars(rule.template.subject, vars),
      },
    })
  }

  return dispatched
}
