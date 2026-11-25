import { prisma } from "@/lib/prisma/client"

// L'auteur d'un changement de statut peut être staff sans Membre associé — completedByMembreId
// reste alors null (voir Phase 7 : résolution User → Membre, même requête que le widget "Mes
// tâches" du tableau de bord). Partagé par la complétion staff, la complétion portail et le
// PATCH générique (réouverture incluse).
export async function resolveActingMembreId(userId: string, associationId: string): Promise<string | null> {
  const membre = await prisma.membre.findFirst({
    where:  { userId, associationId, deletedAt: null },
    select: { id: true },
  })
  return membre?.id ?? null
}

// Partagé entre la complétion côté staff (dashboard) et côté membre (portail) — même logique,
// n'écrit jamais sur autre chose que Tache (voir FORM-118 : compléter une tâche ne doit jamais
// changer le statut de la donnée source qu'elle suit, ex. une Cotisation reste en retard tant
// qu'elle n'est pas réellement payée).
export async function completeTache(tacheId: string, completedByMembreId: string | null) {
  return prisma.tache.update({
    where: { id: tacheId },
    data: {
      status:      "TERMINEE",
      completedAt: new Date(),
      completedByMembreId,
    },
  })
}

// Réouverture (À faire/En cours) — efface qui/quand l'a terminée, sinon une tâche rouverte
// afficherait encore "Terminée par X le Y" dans le panneau de détail. Staff uniquement : le
// portail membre n'offre pas cette transition (voir PATCH /api/portal/taches/[id]).
export async function reopenTache(tacheId: string, status: "A_FAIRE" | "EN_COURS") {
  return prisma.tache.update({
    where: { id: tacheId },
    data: {
      status,
      completedAt:         null,
      completedByMembreId: null,
    },
  })
}
