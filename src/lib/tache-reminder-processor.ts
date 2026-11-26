import { prisma } from "@/lib/prisma/client"
import { sendEmailBatch } from "@/lib/mail"
import { customEmail } from "@/lib/email"
import { translateEmailContent, detectEmailSourceLanguage } from "@/lib/i18n/translate"
import { substituteVars } from "@/lib/automation"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { shouldFireReminderToday, tacheDueDateLocal } from "@/lib/tache-status"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales"
import { format } from "date-fns"
import { APP_URL } from "@/lib/env"

const BATCH_SIZE = 100

// Pas de job planifié persistant : le sweep requery l'état vivant de chaque Tache à chaque
// passage (assignés courants, dueDate courante, status courant) — compléter une tâche ou
// changer ses assignés change simplement ce que la prochaine requête matche, sans annulation
// explicite. Voir la même logique dans processMembershipExpiring (automation-processor.ts).
export async function sweepTacheReminders(now: Date = new Date()): Promise<number> {
  const openTaches = await prisma.tache.findMany({
    where: { status: { not: "TERMINEE" }, reminders: { some: {} } },
    include: {
      reminders: true,
      assignees: {
        include: { membre: { select: { id: true, firstName: true, lastName: true, email: true, preferredLocale: true } } },
      },
      association: { select: { id: true, name: true, slug: true } },
    },
  })

  let sent = 0

  for (const tache of openTaches) {
    // Invariant posée côté API (POST/PATCH /api/taches) : un rappel ne peut exister que si
    // dueDate est renseignée, et effacer dueDate efface les rappels — ce `continue` ne
    // devrait jamais déclencher en pratique, mais reste défensif plutôt que de supposer
    // l'invariante tenue indéfiniment (et satisfait le null-narrowing de TypeScript).
    if (!tache.dueDate) continue
    const dueDate = tache.dueDate

    for (const reminder of tache.reminders) {
      if (!shouldFireReminderToday(dueDate, reminder, now)) continue

      const assigneesWithEmail = tache.assignees.filter(a => a.membre.email)
      if (assigneesWithEmail.length === 0) continue

      // Dédup par membre (pas seulement par tâche+offset) : un assigné ajouté après coup doit
      // encore recevoir le rappel au prochain sweep même si l'offset a déjà été envoyé aux
      // autres ; rend aussi un deuxième passage du sweep le même jour idempotent.
      const alreadySent = await prisma.tacheReminderLog.findMany({
        where: {
          tacheId: tache.id, offsetDays: reminder.offsetDays, direction: reminder.direction,
          membreId: { in: assigneesWithEmail.map(a => a.membreId) },
        },
        select: { membreId: true },
      })
      const alreadySentIds = new Set(alreadySent.map(l => l.membreId))
      const targets = assigneesWithEmail.filter(a => !alreadySentIds.has(a.membreId))
      if (targets.length === 0) continue

      // {{titre_tache}}/{{date_echeance}} restent protégés pendant la traduction (même
      // convention que {{prenom}}/{{date_expiration}} dans automation-processor.ts) — un
      // titre de tâche saisi par l'utilisateur ou une date déjà formatée ne doivent jamais
      // repasser par le traducteur, qui pourrait les altérer (cf. pièges ICU/Azure connus).
      const subjectTemplate = reminder.direction === "AVANT"
        ? "Rappel — échéance à venir : {{titre_tache}}"
        : "Rappel — échéance dépassée : {{titre_tache}}"
      const bodyTemplate = `
        <p>Bonjour,</p>
        <p>La tâche <strong>{{titre_tache}}</strong> ${reminder.direction === "AVANT" ? "arrive à échéance" : "a dépassé son échéance"}
        le {{date_echeance}}.</p>
        ${tache.description ? `<p>${tache.description}</p>` : ""}
        <p><a href="${APP_URL}/portal/${tache.association.slug}/taches">Voir mes tâches</a></p>
      `.trim()

      const sourceLanguage = await detectEmailSourceLanguage(subjectTemplate, bodyTemplate)
      const locales = [...new Set(targets.map(a => (a.membre.preferredLocale as Locale | null) ?? DEFAULT_LOCALE))]
      const translations = new Map(await Promise.all(locales.map(async locale => {
        const result = await translateEmailContent(subjectTemplate, bodyTemplate, locale, tache.associationId, sourceLanguage)
        return [locale, { subject: result.subject, bodyHtml: result.bodyHtml }] as const
      })))

      const branding = await resolveEmailBranding(tache.associationId)
      const emailJobs = targets.map(a => {
        const locale   = (a.membre.preferredLocale as Locale | null) ?? DEFAULT_LOCALE
        const content  = translations.get(locale) ?? { subject: subjectTemplate, bodyHtml: bodyTemplate }
        const vars     = { titre_tache: tache.titre, date_echeance: format(tacheDueDateLocal(dueDate), "d MMMM yyyy", { locale: getDateFnsLocale(locale) }) }
        return {
          membreId: a.membreId,
          payload: {
            ...customEmail({
              associationName: tache.association.name,
              subject:         substituteVars(content.subject, vars),
              bodyHtml:        substituteVars(content.bodyHtml, vars),
              recipientEmail:  a.membre.email!,
              branding,
            }),
            context: { associationId: tache.associationId, membreId: a.membreId, source: "TACHE_REMINDER", sourceId: tache.id },
          },
        }
      })

      for (let i = 0; i < emailJobs.length; i += BATCH_SIZE) {
        const chunk     = emailJobs.slice(i, i + BATCH_SIZE)
        const results   = await sendEmailBatch(chunk.map(j => j.payload))
        const succeeded = chunk.filter((_, idx) => results[idx].ok)
        if (succeeded.length > 0) {
          // createMany seulement pour les envois réussis — un échec partiel sera retenté
          // proprement au prochain sweep, même logique que processMembershipExpiring.
          await prisma.tacheReminderLog.createMany({
            data: succeeded.map(j => ({
              tacheId: tache.id, offsetDays: reminder.offsetDays, direction: reminder.direction, membreId: j.membreId,
            })),
          })
          sent += succeeded.length
        }
      }
    }
  }

  return sent
}
