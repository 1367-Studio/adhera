// Partagé entre GET /api/taches (liste), le calendrier, GET /api/taches/summary (cards de
// résumé, FORM-118) et GET /api/dashboard (carte "Mes tâches") — chaque consommateur doit
// parser et appliquer les filtres de façon identique, même convention que
// src/lib/cotisation-query.ts.

import { parisDayBounds } from "@/lib/membre-adherent"

export type TacheStatusFilter = "A_FAIRE" | "EN_COURS" | "TERMINEE" | "EN_RETARD"

export type TacheFilters = {
  membreId?:    string
  categorieId?: string
  status?:      TacheStatusFilter
  // "À venir" uniquement — le "En retard" équivalent vit déjà dans `status: "EN_RETARD"`
  // (voir buildTacheWhere) ; avoir le même libellé sur deux filtres indépendants laissait
  // l'un exclure TERMINEE et l'autre non, et les deux combinés pouvaient produire un résultat
  // vide sans explication. Résolu côté serveur (pas de timestamp envoyé par le client) pour
  // que la queryKey reste stable d'un rendu à l'autre — voir use-taches.ts.
  // "soon7" (card « Échéance sous 7 jours »), "today" et "fromTomorrow" (card du dashboard
  // "Mes tâches" — FORM-118 et FORM-128 commentaires Emmanuelle) suivent la même convention :
  // résolus ici, pas envoyés en timestamp par le client.
  dueFilter?:   "upcoming" | "soon7" | "today" | "fromTomorrow"
  // Plage explicite réservée au calendrier (useTachesByMonth) — un usage distinct du filtre
  // "À venir" ci-dessus, non sujet au même problème puisque year/month ne changent qu'à la
  // navigation, pas à chaque rendu.
  dueBefore?:   string
  dueAfter?:    string
  search?:      string
}

function isStatusFilter(value: string | null): value is TacheStatusFilter {
  return value === "A_FAIRE" || value === "EN_COURS" || value === "TERMINEE" || value === "EN_RETARD"
}

export function parseTacheFilters(searchParams: URLSearchParams): TacheFilters {
  const status = searchParams.get("status")
  const due    = searchParams.get("dueFilter")
  return {
    membreId:    searchParams.get("membreId")?.trim() || undefined,
    categorieId: searchParams.get("categorieId")?.trim() || undefined,
    status:      isStatusFilter(status) ? status : undefined,
    dueFilter:   due === "upcoming" || due === "soon7" || due === "today" || due === "fromTomorrow" ? due : undefined,
    dueBefore:   searchParams.get("dueBefore")?.trim() || undefined,
    dueAfter:    searchParams.get("dueAfter")?.trim() || undefined,
    search:      searchParams.get("search")?.trim() || undefined,
  }
}

// "EN_RETARD" n'est pas une valeur de TacheStatus en base (voir src/lib/tache-status.ts) — se
// traduit ici en la même condition que isTacheOverdue, pour que le filtre liste exactement les
// mêmes lignes que le badge "En retard" affiché ailleurs. Une tâche sans échéance ne matche
// jamais une comparaison lt/gte en SQL (NULL n'est ni < ni >= quoi que ce soit) — elle est
// donc naturellement exclue des deux filtres de date ci-dessous sans condition explicite.
export function buildTacheWhere(associationId: string, filters: TacheFilters): Record<string, unknown> {
  const where: Record<string, unknown> = { associationId }

  if (filters.status === "EN_RETARD") {
    where.status  = { not: "TERMINEE" }
    where.dueDate = { lt: new Date() }
  } else if (filters.status) {
    where.status = filters.status
  }

  if (filters.membreId)    where.assignees = { some: { membreId: filters.membreId } }
  if (filters.categorieId) where.categorieId = filters.categorieId

  // Résolu ici (pas par le client) : "aujourd'hui" est toujours l'instant de la requête, pas
  // un timestamp figé envoyé depuis le navigateur.
  if (filters.dueFilter === "upcoming") {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const dueDateRange = where.dueDate && typeof where.dueDate === "object" ? { ...where.dueDate as object } : {}
    where.dueDate = { ...dueDateRange, gte: todayStart }
    if (where.status === undefined) where.status = { not: "TERMINEE" }
  }

  // Card « Échéance sous 7 jours » (FORM-118, commentaire Emmanuelle) : du début du jour
  // courant jusqu'à la fin du 7e jour suivant, inclusif des deux bords. Fuseau Europe/Paris
  // (pas l'heure serveur) — même raison que le ramo "today" juste en dessous : une tâche
  // calée à minuit UTC (convention de création, voir POST /api/taches) ne doit pas sortir du
  // card simplement parce que le serveur tourne dans un autre fuseau.
  if (filters.dueFilter === "soon7") {
    const { dayStart: todayStart } = parisDayBounds(new Date())
    const { dayEnd: in7DaysEnd }   = parisDayBounds(new Date(todayStart.getTime() + 7 * 86_400_000))
    const dueDateRange = where.dueDate && typeof where.dueDate === "object" ? { ...where.dueDate as object } : {}
    where.dueDate = { ...dueDateRange, gte: todayStart, lte: in7DaysEnd }
    if (where.status === undefined) where.status = { not: "TERMINEE" }
  }

  // Section "Aujourd'hui" de la carte dashboard "Mes tâches" (FORM-118, commentaire
  // Emmanuelle) : borne au fuseau Europe/Paris (pas l'heure serveur) — même raison que
  // shouldFireReminderToday dans tache-status.ts.
  if (filters.dueFilter === "today") {
    const { dayStart, dayEnd } = parisDayBounds(new Date())
    const dueDateRange = where.dueDate && typeof where.dueDate === "object" ? { ...where.dueDate as object } : {}
    where.dueDate = { ...dueDateRange, gte: dayStart, lte: dayEnd }
    if (where.status === undefined) where.status = { not: "TERMINEE" }
  }

  // Section "Prochaines échéances" de la carte dashboard "Mes tâches" (FORM-128, commentaire
  // Emmanuelle) : à partir de demain (fuseau Europe/Paris, pas l'heure serveur), sans plafond —
  // contrairement à "soon7" qui s'arrête au 7e jour, une tâche qui échoit dans dix jours doit
  // quand même pouvoir remonter ici.
  if (filters.dueFilter === "fromTomorrow") {
    const { dayStart: todayStart } = parisDayBounds(new Date())
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000)
    const dueDateRange = where.dueDate && typeof where.dueDate === "object" ? { ...where.dueDate as object } : {}
    where.dueDate = { ...dueDateRange, gte: tomorrowStart }
    if (where.status === undefined) where.status = { not: "TERMINEE" }
  }

  if (filters.dueBefore || filters.dueAfter) {
    const dueDateRange = where.dueDate && typeof where.dueDate === "object" ? { ...where.dueDate as object } : {}
    if (filters.dueAfter)  Object.assign(dueDateRange, { gte: new Date(filters.dueAfter) })
    if (filters.dueBefore) Object.assign(dueDateRange, { lte: new Date(filters.dueBefore) })
    where.dueDate = dueDateRange
  }

  if (filters.search) where.titre = { contains: filters.search, mode: "insensitive" }

  return where
}
