import { prisma } from "@/lib/prisma/client"
import { APP_TIME_ZONE } from "@/lib/date-format"
import { inngest } from "@/lib/inngest"
import { customEmail } from "@/lib/email"
import { parseModules } from "@/lib/modules"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { substituteVars, buildVars } from "@/lib/automation"
import type { AssociationPlan, MessageChannel, TriggerType } from "@prisma/client"

type EventTrigger = Extract<TriggerType, "RSVP_CONFIRMED" | "MEMBER_CREATED">

interface FireParams {
  triggerType:   EventTrigger
  associationId: string
  association:   {
    name: string; slug: string; modules: unknown
    plan: AssociationPlan; customBrandingEnabled: boolean | null
    logoUrl: string | null
  }
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
      ? evenement.date.toLocaleDateString("fr-FR", { timeZone: APP_TIME_ZONE, day: "numeric", month: "long", year: "numeric" })
      : undefined,
    lieuEvenement: evenement?.location ?? undefined,
  })

  const channel = rule.channel as MessageChannel
  let dispatched = false

  if ((channel === "EMAIL" || channel === "BOTH") && membre.email) {
    await inngest.send({
      name: "automation/event-rule.email-requested",
      data: {
        payload: customEmail({
          associationName: association.name,
          subject:         substituteVars(rule.template.subject, vars),
          bodyHtml:        substituteVars(rule.template.body, vars),
          recipientEmail:  membre.email,
          branding:        resolveDocumentBranding(association),
        }),
        context: { associationId, membreId: membre.id, source: "AUTOMATION", sourceId: rule.id },
      },
    }).catch(() => {})
    dispatched = true
  }

  if ((channel === "SMS" || channel === "BOTH") && mods.sms && rule.template.smsBody && membre.phone) {
    await inngest.send({
      name: "automation/event-rule.sms-requested",
      data: {
        to:            membre.phone,
        body:          substituteVars(rule.template.smsBody, vars),
        associationId,
        context:       { membreId: membre.id, source: "AUTOMATION", sourceId: rule.id },
      },
    }).catch(() => {})
    dispatched = true
  }

  // "dispatched" means handed off, not confirmed — the actual send now happens in an
  // Inngest function (with its own retries), so this AutomationLog row (and its subject
  // line) exists whether that send actually goes through or not. The real per-message
  // outcome — including failures — lives in EmailMessage/SmsMessage, keyed by this same
  // source/sourceId ("AUTOMATION"/rule.id).
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
