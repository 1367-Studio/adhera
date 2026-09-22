import type { UserRole } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"

// Mêmes rôles que les autres alertes financières (voir le webhook Stripe) : encaisser sans
// enregistrer est un problème de trésorerie, pas d'animation de l'association. Typé UserRole[]
// et non `as const` : le filtre `in` de Prisma attend un tableau mutable de l'enum généré.
const MANAGER_ROLES: UserRole[] = ["ADMIN", "PRESIDENT", "TRESORIER"]

/**
 * Prévient les gestionnaires qu'un paiement d'adhésion encaissé n'a produit aucune cotisation.
 *
 * Ce silence est le vrai défaut derrière le cas Léa Marques (septembre 2026) : la facture était
 * payée chez Stripe, le webhook a renoncé au bout de ses reprises en écrivant un `console.error`
 * que personne ne lit, et l'association ne l'a su que trois semaines plus tard, par hasard. Une
 * notification en base rend l'abandon visible là où quelqu'un le verra.
 *
 * `groupKey` dédoublonne : une seule alerte par sujet, jamais répétée au balayage suivant, même
 * si l'anomalie persiste — la fiche du membre porte de son côté un avertissement permanent.
 * Renvoie true seulement si une alerte a réellement été créée.
 */
export async function notifyMissingCotisation(params: {
  associationId: string
  groupKey:      string
  title:         string
  body:          string
  link:          string
}): Promise<boolean> {
  const { associationId, groupKey, title, body, link } = params
  try {
    const alreadyAlerted = await prisma.notification.findFirst({ where: { groupKey }, select: { id: true } })
    if (alreadyAlerted) return false

    const managers = await prisma.user.findMany({
      where:  { associationId, role: { in: MANAGER_ROLES }, active: true, deletedAt: null },
      select: { id: true },
    })
    if (managers.length === 0) return false

    await prisma.notification.createMany({
      data: managers.map(manager => ({ userId: manager.id, groupKey, title, body, link, scope: "GESTION" as const })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
    return true
  } catch (error) {
    // Jamais bloquant : cette alerte accompagne un paiement déjà encaissé, elle ne doit pas
    // faire échouer le webhook qui la déclenche ni la tâche qui la balaie.
    console.error(`[cotisation-alerts] notification "${groupKey}" impossible à créer:`, error)
    return false
  }
}
