import { prisma } from "@/lib/prisma/client"
import { sendEmailBatch } from "@/lib/mail"
import { customEmail } from "@/lib/email"
import { translateEmailContent, detectEmailSourceLanguage } from "@/lib/i18n/translate"
import { substituteVars } from "@/lib/automation"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { tacheDueDateLocal } from "@/lib/tache-status"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales"
import { format } from "date-fns"
import { APP_URL } from "@/lib/env"

// Envoi synchrone à l'assignation (pas de sweep impliqué, contrairement aux rappels par
// échéance) — appelé depuis POST /api/taches et depuis le diff d'assignés de PATCH
// /api/taches/[id]. "Affichage dans l'espace membre" est déjà couvert par la page Mes
// tâches du portail (requête live), pas besoin d'un modèle Notification séparé.
export async function notifyNewTacheAssignees(params: {
  tacheId: string
  associationId: string
  titre: string
  dueDate: Date | null
  membreIds: string[]
}) {
  if (params.membreIds.length === 0) return

  const [association, membres] = await Promise.all([
    prisma.association.findUnique({ where: { id: params.associationId }, select: { name: true, slug: true } }),
    prisma.membre.findMany({
      where:  { id: { in: params.membreIds }, email: { not: null } },
      select: { id: true, email: true, preferredLocale: true },
    }),
  ])
  if (!association || membres.length === 0) return

  // Deux variantes de phrase selon qu'une échéance existe — "Tarefas sem prazo continuam
  // visíveis" (FORM-118) : une tâche sans prazo est un cas normal, pas une donnée manquante.
  const subjectTemplate = "Nouvelle tâche assignée : {{titre_tache}}"
  const bodyTemplate = params.dueDate
    ? `
      <p>Bonjour,</p>
      <p>Une nouvelle tâche vous a été attribuée : <strong>{{titre_tache}}</strong>, à réaliser avant le {{date_echeance}}.</p>
      <p><a href="${APP_URL}/portal/${association.slug}/taches">Voir mes tâches</a></p>
    `.trim()
    : `
      <p>Bonjour,</p>
      <p>Une nouvelle tâche vous a été attribuée : <strong>{{titre_tache}}</strong>.</p>
      <p><a href="${APP_URL}/portal/${association.slug}/taches">Voir mes tâches</a></p>
    `.trim()

  const sourceLanguage = await detectEmailSourceLanguage(subjectTemplate, bodyTemplate)
  const locales = [...new Set(membres.map(m => (m.preferredLocale as Locale | null) ?? DEFAULT_LOCALE))]
  const translations = new Map(await Promise.all(locales.map(async locale => {
    const result = await translateEmailContent(subjectTemplate, bodyTemplate, locale, params.associationId, sourceLanguage)
    return [locale, { subject: result.subject, bodyHtml: result.bodyHtml }] as const
  })))

  const branding = await resolveEmailBranding(params.associationId)
  const payloads = membres.map(m => {
    const locale  = (m.preferredLocale as Locale | null) ?? DEFAULT_LOCALE
    const content = translations.get(locale) ?? { subject: subjectTemplate, bodyHtml: bodyTemplate }
    // tacheDueDateLocal : dueDate est stockée à minuit UTC (jour calendaire pur) — la
    // reformater en Date "locale" avant format() évite qu'elle affiche la veille pour un
    // lecteur dans un fuseau en arrière de UTC (voir le commentaire sur tacheDueDateLocal).
    const vars = {
      titre_tache: params.titre,
      date_echeance: params.dueDate ? format(tacheDueDateLocal(params.dueDate), "d MMMM yyyy", { locale: getDateFnsLocale(locale) }) : "",
    }
    return {
      ...customEmail({
        associationName: association.name,
        subject:         substituteVars(content.subject, vars),
        bodyHtml:        substituteVars(content.bodyHtml, vars),
        recipientEmail:  m.email!,
        branding,
      }),
      context: { associationId: params.associationId, membreId: m.id, source: "TACHE_ASSIGNED", sourceId: params.tacheId },
    }
  })

  await sendEmailBatch(payloads)
}
