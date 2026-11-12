import { z } from "zod"

export const CHAMADA_PRESENCA_STATUSES = [
  "NAO_INFORMADO", "PRESENTE", "AUSENTE", "AUSENCIA_JUSTIFICADA",
] as const

export type ChamadaPresencaStatusValue = typeof CHAMADA_PRESENCA_STATUSES[number]

export const chamadaCreateSchema = z.object({
  data:      z.string().min(1, "Date requise"),
  horario:   z.string().trim().max(30).optional().or(z.literal("")),
  atividade: z.string().trim().max(150).optional().or(z.literal("")),
})

export const chamadaPresencaEntrySchema = z.object({
  membreId: z.string().min(1),
  status:   z.enum(CHAMADA_PRESENCA_STATUSES),
})

export const chamadaUpdateSchema = z.object({
  data:       z.string().min(1).optional(),
  horario:    z.string().trim().max(30).optional().or(z.literal("")),
  atividade:  z.string().trim().max(150).optional().or(z.literal("")),
  entries:    z.array(chamadaPresencaEntrySchema).max(2000).optional(),
  // Concurrence optimiste (FORM-97 edge case) : la vue envoie l'updatedAt qu'elle a chargé ;
  // si quelqu'un d'autre a déjà sauvegardé entre-temps, le serveur refuse plutôt que
  // d'écraser silencieusement ses changements avec notre état local périmé.
  expectedUpdatedAt: z.string().optional(),
})

export type ChamadaCreateInput         = z.infer<typeof chamadaCreateSchema>
export type ChamadaUpdateInput         = z.infer<typeof chamadaUpdateSchema>
export type ChamadaPresencaEntryInput  = z.infer<typeof chamadaPresencaEntrySchema>
