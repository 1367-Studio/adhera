import { inngest } from "@/lib/inngest"
import { prisma } from "@/lib/prisma/client"
import { notifyMissingCotisation } from "@/lib/cotisation-alerts"

// Un abonnement de cotisation prélève tout seul, une fois par an. Si sa toute première facture
// se perd — webhook arrivé avant que la ligne d'abonnement existe, puis reprises abandonnées,
// voir shouldRetryUntilCheckoutProcessed — l'adhérent est bel et bien débité, n'apparaît nulle
// part comme adhérent, la recette manque à la comptabilité, et rien ne le signale. C'est
// exactement ce qui est arrivé en septembre 2026, découvert trois semaines plus tard et par
// hasard. Ce balayage est le filet : il rattrape la perte quelle qu'en soit la cause, y compris
// celles qu'on n'a pas su reconstituer.
//
// La détection ne peut pas produire de faux positif : une ligne ACTIVE n'existe que parce qu'un
// paiement récurrent a réellement été mis en place, elle doit donc avoir produit au moins une
// cotisation. Un vrai bénévole, lui, n'a pas d'abonnement du tout.
const GRACE_PERIOD_HOURS = 24

export const cotisationSubscriptionSweep = inngest.createFunction(
  // 8h, avant automation-sweep (9h) et event-review-request (10h) : trois tâches quotidiennes
  // qui ne se marchent pas dessus.
  { id: "cotisation-subscription-sweep", triggers: { cron: "0 8 * * *" } },
  async ({ step }) => {
    const orphanSubscriptions = await step.run("find-subscriptions-without-cotisation", async () => {
      // Le délai de grâce laisse passer les reprises normales de Stripe : un abonnement souscrit
      // il y a dix minutes dont la facture n'est pas encore traitée n'a rien d'anormal.
      const cutoff = new Date(Date.now() - GRACE_PERIOD_HOURS * 3_600_000)
      return prisma.cotisationSubscription.findMany({
        where:  { status: "ACTIVE", startedAt: { lte: cutoff }, cotisations: { none: {} } },
        select: {
          id: true, associationId: true, amount: true, startedAt: true,
          membre: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    })

    if (orphanSubscriptions.length === 0) return { found: 0, alerted: 0 }

    const alerted = await step.run("alert-managers", async () => {
      let notificationsCreated = 0
      for (const subscription of orphanSubscriptions) {
        const formattedAmount = Number(subscription.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
        const wasAlerted = await notifyMissingCotisation({
          associationId: subscription.associationId,
          // Une seule alerte par abonnement : la fiche du membre porte de son côté un
          // avertissement permanent tant que l'anomalie n'est pas corrigée.
          groupKey:      `cotisation-subscription-orphan:${subscription.id}`,
          title:         "Adhésion payée sans cotisation enregistrée",
          body:          `${subscription.membre.firstName} ${subscription.membre.lastName} a un abonnement actif de ${formattedAmount}, mais aucune cotisation n'a jamais été enregistrée à son nom. Le paiement a probablement été encaissé chez Stripe sans avoir pu être rattaché.`,
          link:          `/dashboard/membres/${subscription.membre.id}`,
        })
        if (wasAlerted) notificationsCreated++
      }
      return notificationsCreated
    })

    return { found: orphanSubscriptions.length, alerted }
  },
)
