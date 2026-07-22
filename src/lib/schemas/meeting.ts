import { z } from "zod"

const meetingObjectSchema = z.object({
  title:          z.string().trim().min(1, "Titre requis"),
  description:    z.string().trim().optional().or(z.literal("")),
  type:           z.enum(["AG", "BUREAU", "GENERALE"]).optional(),
  scheduledAt:    z.string().optional().or(z.literal("")),
  participantIds: z.array(z.string()).optional(),
  instant:        z.boolean().optional(),
})

export const meetingCreateSchema = meetingObjectSchema

export const meetingUpdateSchema = z.object({
  title:          z.string().trim().min(1, "Titre requis").optional(),
  description:    z.string().trim().optional().or(z.literal("")),
  type:           z.enum(["AG", "BUREAU", "GENERALE"]).optional(),
  scheduledAt:    z.string().optional().or(z.literal("")),
  participantIds: z.array(z.string()).optional(),
  status:         z.enum(["SCHEDULED", "LIVE", "ENDED", "CANCELLED"]).optional(),
  endedAt:        z.string().optional(),
  summary:        z.string().optional(),
  transcript:     z.string().optional(),
})

export type MeetingCreateInput = z.infer<typeof meetingCreateSchema>
export type MeetingUpdateInput = z.infer<typeof meetingUpdateSchema>
