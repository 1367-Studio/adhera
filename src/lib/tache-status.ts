import { parisDayBounds } from "@/lib/membre-adherent"

// Source unique de vérité pour "En retard" — ce n'est pas un statut en base (voir
// TacheStatus), mais un dérivé calculé à la volée, exactement comme pour Cotisation/Material.
// Réutilisé par la liste, le panneau de détail, le calendrier et le filtre serveur pour que les
// quatre ne puissent jamais diverger.

export type TacheOverdueInput = {
  dueDate: Date | string | null
  status:  string
}

// Pas d'échéance = jamais en retard (voir FORM-118 : "Tarefas sem prazo continuam visíveis
// na lista" — une tâche sans prazo n'a simplement pas cette notion).
export function isTacheOverdue(tache: TacheOverdueInput, now: Date = new Date()): boolean {
  if (tache.status === "TERMINEE" || tache.dueDate == null) return false
  const dueDate = typeof tache.dueDate === "string" ? new Date(tache.dueDate) : tache.dueDate
  return dueDate.getTime() < now.getTime()
}

// dueDate est toujours stockée à minuit UTC (voir POST/PATCH /api/taches) — un "jour
// calendaire pur", sans heure significative. date-fns format()/isSameDay() lisent l'heure
// LOCALE du navigateur/serveur, pas UTC : pour un visiteur dans un fuseau en arrière de UTC
// (ex. Amériques), minuit UTC du 27 novembre tombe le 26 novembre en heure locale, et la
// date affichée/la case du calendrier seraient décalées d'un jour. Cette fonction recompose
// un Date dont les champs LOCAUX reproduisent le jour calendaire UTC voulu, pour que tout
// affichage (format(), isSameDay()) retombe juste quel que soit le fuseau du lecteur.
export function tacheDueDateLocal(dueDate: Date | string): Date {
  const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export type TacheReminderInput = { offsetDays: number; direction: "AVANT" | "APRES" }

// Pure day-bucket check extrait de sweepTacheReminders (src/lib/tache-reminder-processor.ts)
// pour rester testable sans mocker Prisma — même convention que le reste du codebase, qui ne
// teste que les fonctions pures extraites des processeurs couplés à la DB (voir
// processMembershipExpiring, jamais testé directement). Précision Paris, pas UTC serveur —
// même raison que parisDayBounds partout ailleurs : un sweep tournant après minuit UTC mais
// avant minuit Paris ne doit pas se tromper de jour calendaire côté Europe/Paris.
export function shouldFireReminderToday(dueDate: Date, reminder: TacheReminderInput, now: Date): boolean {
  const targetDay = new Date(
    dueDate.getTime() + (reminder.direction === "AVANT" ? -1 : 1) * reminder.offsetDays * 86_400_000,
  )
  const { dayStart, dayEnd } = parisDayBounds(targetDay)
  return now >= dayStart && now <= dayEnd
}
