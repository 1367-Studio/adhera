import { z } from "zod"
import { stripHtml } from "@/lib/utils"

export const actualiteSchema = z.object({
  title:         z.string().min(1, "Titre requis").max(200),
  content:       z.string()
    .refine((v) => stripHtml(v).length > 0, "Contenu requis")
    .refine((v) => stripHtml(v).length <= 50000, "Contenu trop long (max 50 000 caractères)"),
  imageUrl:      z.string().optional().or(z.literal("")),
  pinned:        z.boolean(),
  evenementId:   z.string().optional().or(z.literal("")),
  recipientMode: z.enum(["ALL", "SELECTED"]),
  recipientIds:  z.array(z.string()).optional(),
})

export const actualiteUpdateSchema = z.object({
  title:         z.string().min(1).max(200).optional(),
  content:       z.string().optional(),
  imageUrl:      z.string().optional().or(z.literal("")),
  pinned:        z.boolean().optional(),
  evenementId:   z.string().optional().or(z.literal("")),
  recipientMode: z.enum(["ALL", "SELECTED"]).optional(),
  recipientIds:  z.array(z.string()).optional(),
  publishedAt:   z.string().nullable().optional(),
})

export type ActualiteInput       = z.infer<typeof actualiteSchema>
export type ActualiteUpdateInput = z.infer<typeof actualiteUpdateSchema>
