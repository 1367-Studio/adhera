import { z } from "zod"

// Upserts one BudgetLine (exercice + category + optional project). `projectId: null` (or
// omitted) targets the "sans projet" line of a category on the global budget tab; a real id
// targets that project's own line — see BudgetLine's doc comment in schema.prisma.
export const budgetLineUpsertSchema = z.object({
  exerciceId: z.string().min(1, "Exercice requis"),
  categoryId: z.string().min(1, "Catégorie requise"),
  projectId:  z.string().min(1).nullable().optional(),
  amount:     z.number().min(0, "Montant doit être positif ou nul"),
})

export type BudgetLineUpsertInput = z.infer<typeof budgetLineUpsertSchema>

// Detaches one category from a project's budget (the row added by "Adicionar catégorie au
// projet") — `projectId` is required here, unlike the upsert schema: removing the "sans
// projet" line of the global budget isn't a supported action, only a project's own line.
export const budgetLineDeleteSchema = z.object({
  exerciceId: z.string().min(1, "Exercice requis"),
  categoryId: z.string().min(1, "Catégorie requise"),
  projectId:  z.string().min(1, "Projet requis"),
})

export type BudgetLineDeleteInput = z.infer<typeof budgetLineDeleteSchema>

export const budgetProjectSchema = z.object({
  name:        z.string().trim().min(1, "Nom requis"),
  description: z.string().trim().optional().or(z.literal("")),
})

export type BudgetProjectInput = z.infer<typeof budgetProjectSchema>

export const budgetProjectUpdateSchema = z.object({
  name:        z.string().trim().min(1, "Nom requis").optional(),
  description: z.string().trim().optional().or(z.literal("")),
  archived:    z.boolean().optional(),
})

export type BudgetProjectUpdateInput = z.infer<typeof budgetProjectUpdateSchema>

// `projectIds: "all"` copies every project's lines (archived included — copying a past
// budget shouldn't silently skip a project just because it got archived since); an explicit
// array copies only those. The "sans projet" lines are always copied regardless.
export const budgetCopySchema = z.object({
  targetExerciceId: z.string().min(1, "Exercice cible requis"),
  projectIds:       z.union([z.literal("all"), z.array(z.string().min(1))]),
  confirmOverwrite: z.boolean().default(false),
})

export type BudgetCopyInput = z.infer<typeof budgetCopySchema>
