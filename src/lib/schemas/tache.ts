import { z } from "zod"

export const TITRE_MAX       = 150
export const TACHE_DESCRIPTION_MAX = 2000
export const NOM_CATEGORIE_MAX = 80

const tacheReminderSchema = z.object({
  offsetDays: z.number().int().positive("Doit être un nombre de jours positif"),
  direction:  z.enum(["AVANT", "APRES"]),
})

// Pas de refine ici pour les doublons/la dépendance à dueDate — zod ne sait valider un champ
// contre un autre qu'à la racine d'un schéma (voir tacheSchema/tacheUpdateSchema plus bas),
// donc ces deux règles vivent sur les schémas composés, pas sur ce bloc réutilisé seul.
function hasDuplicateReminder(reminders: { offsetDays: number; direction: "AVANT" | "APRES" }[]): boolean {
  const seen = new Set(reminders.map(r => `${r.offsetDays}-${r.direction}`))
  return seen.size !== reminders.length
}

const tacheBase = z.object({
  titre:         z.string().trim().min(1, "Titre requis").max(TITRE_MAX, `Maximum ${TITRE_MAX} caractères`),
  description:   z.string().trim().max(TACHE_DESCRIPTION_MAX, `Maximum ${TACHE_DESCRIPTION_MAX} caractères`).optional().or(z.literal("")),
  categorieId:   z.string().optional().nullable(),
  // 0 autorisé — une tâche peut rester "Non attribuée" jusqu'à ce qu'un responsable choisisse
  // qui la réalise (voir le ticket FORM-118). `.optional()` plutôt que `.default([])` : un
  // defaut sur un tableau fait diverger le type input/output de zod et casse le générique de
  // zodResolver — useForm fournit déjà `[]` via ses propres defaultValues.
  assigneeIds:   z.array(z.string().min(1)).optional(),
  // Optionnel — "Tarefas sem prazo continuam visíveis na lista" (ticket FORM-118) : une tâche
  // peut n'avoir aucune échéance. `null`/`""` effacent une échéance existante (distinct
  // d'`undefined`, qui la laisse telle quelle sur un PATCH partiel).
  dueDate:       z.string().optional().nullable().or(z.literal("")),
  reminders:     z.array(tacheReminderSchema).max(10).optional(),
  // Renseignés uniquement quand la tâche est créée depuis le panneau "Actions à faire" du
  // tableau de bord (FORM-119) — capturés en snapshot à la création, jamais re-résolus.
  linkBackHref:  z.string().max(500).optional().nullable(),
  linkBackLabel: z.string().max(200).optional().nullable(),
})

export const tacheSchema = tacheBase
  .refine(d => !d.reminders || !hasDuplicateReminder(d.reminders), {
    message: "Deux rappels identiques ne peuvent pas être ajoutés.", path: ["reminders"],
  })
  .refine(d => !d.reminders || d.reminders.length === 0 || !!d.dueDate, {
    message: "Une échéance est requise pour configurer un rappel.", path: ["dueDate"],
  })

// `status` uniquement sur l'update : une tâche est toujours créée A_FAIRE, seul un
// responsable change ensuite le statut à la main (voir TacheDetailSheet) — reprendre ou
// terminer une tâche compte comme une édition, pas une création. PATCH /api/taches/[id]
// recalcule completedAt/completedByMembreId selon cette valeur (reprise = on les efface).
const tacheStatusSchema = z.enum(["A_FAIRE", "EN_COURS", "TERMINEE"])

export const tacheUpdateSchema = tacheBase.extend({ status: tacheStatusSchema.optional() }).partial()
  .refine(d => !d.reminders || !hasDuplicateReminder(d.reminders), {
    message: "Deux rappels identiques ne peuvent pas être ajoutés.", path: ["reminders"],
  })
  // Seulement quand dueDate est explicitement touché dans ce PATCH (sinon on ne connaît pas
  // la valeur existante côté client) — le même garde-fou côté route vérifie aussi l'état réel
  // en base pour le cas où reminders change sans que dueDate soit renvoyé.
  .refine(d => !d.reminders || d.reminders.length === 0 || d.dueDate === undefined || !!d.dueDate, {
    message: "Une échéance est requise pour configurer un rappel.", path: ["dueDate"],
  })

export const tacheCategorieSchema = z.object({
  nom: z.string().trim().min(1, "Nom requis").max(NOM_CATEGORIE_MAX, `Maximum ${NOM_CATEGORIE_MAX} caractères`),
})

export type TacheReminderInput    = z.infer<typeof tacheReminderSchema>
export type TacheInput            = z.infer<typeof tacheSchema>
export type TacheUpdateInput      = z.infer<typeof tacheUpdateSchema>
export type TacheCategorieInput   = z.infer<typeof tacheCategorieSchema>
