import { z } from "zod"

export const NOME_MAX     = 80
export const DESCRICAO_MAX = 300

export const grupoSchema = z.object({
  nome:      z.string().trim().min(1, "Nom requis").max(NOME_MAX, `Maximum ${NOME_MAX} caractères`),
  descricao: z.string().trim().max(DESCRICAO_MAX, `Maximum ${DESCRICAO_MAX} caractères`).optional().or(z.literal("")),
})

export const grupoUpdateSchema = grupoSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const grupoMembroSchema = z.object({
  membreId: z.string().min(1, "Membre requis"),
})

export const grupoResponsavelSchema = z.object({
  userId: z.string().min(1, "Utilisateur requis"),
})

export type GrupoInput             = z.infer<typeof grupoSchema>
export type GrupoUpdateInput       = z.infer<typeof grupoUpdateSchema>
export type GrupoMembroInput       = z.infer<typeof grupoMembroSchema>
export type GrupoResponsavelInput  = z.infer<typeof grupoResponsavelSchema>
