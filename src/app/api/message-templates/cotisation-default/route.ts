import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { guardModule } from "@/lib/auth/require-module"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const DEFAULT_SUBJECT = "Cotisation {{annee_cotisation}} en attente de paiement"
const DEFAULT_BODY =
  "<p>Bonjour {{prenom}},</p>" +
  "<p>Sauf erreur de notre part, votre cotisation de {{montant_cotisation}} € pour l'année {{annee_cotisation}} " +
  "est toujours en attente de paiement.</p>" +
  "<p>Merci de bien vouloir régulariser votre situation dans les meilleurs délais.</p>"
const DEFAULT_SMS_BODY =
  "Bonjour {{prenom}}, sauf erreur de notre part, votre cotisation de {{montant_cotisation}} € pour {{annee_cotisation}} " +
  "est toujours en attente de paiement."

// Lazily creates the association's default cotisation-reminder template the first time
// it's needed (opening src/components/cotisations/send-reminder-modal.tsx) rather than a
// data migration touching every existing association row.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const messagesGuard = await guardModule(associationId, "messages")
  if (messagesGuard) return messagesGuard

  const existing = await prisma.messageTemplate.findFirst({
    where: { associationId, category: "COTISATION", isDefault: true },
  })
  if (existing) return NextResponse.json(existing)

  const created = await prisma.messageTemplate.create({
    data: {
      associationId,
      name:      "Rappel de cotisation (par défaut)",
      category:  "COTISATION",
      subject:   DEFAULT_SUBJECT,
      body:      DEFAULT_BODY,
      smsBody:   DEFAULT_SMS_BODY,
      isDefault: true,
    },
  })
  return NextResponse.json(created)
}, { roles: MANAGERS, module: "cotisations" })
