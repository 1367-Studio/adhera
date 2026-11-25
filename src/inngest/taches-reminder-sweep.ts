import { inngest } from "@/lib/inngest"
import { sweepTacheReminders } from "@/lib/tache-reminder-processor"

// 9h30 — juste après automation-sweep (9h) et avant event-review-request (10h), même
// cadence quotidienne que les autres sweeps (voir src/inngest/*.ts). Aucune contrepartie
// Vercel cron : les sweeps ajoutés après la bascule vers Inngest (ex. cotisation-
// subscription-sweep) n'en ont plus, seul l'historique /api/cron/automations en gardait une
// pour le cutover.
export const tachesReminderSweep = inngest.createFunction(
  { id: "taches-reminder-sweep", triggers: { cron: "30 9 * * *" } },
  async ({ step }) => {
    const sent = await step.run("sweep-tache-reminders", () => sweepTacheReminders(new Date()))
    return { sent }
  },
)
