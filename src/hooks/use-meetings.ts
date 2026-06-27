import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"

export type MeetingParticipant = {
  id: string
  membreId: string
  joinedAt: string | null
  membre: { id: string; firstName: string; lastName: string }
}

export type Meeting = {
  id: string
  title: string
  description: string | null
  status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED"
  scheduledAt: string | null
  startedAt: string | null
  endedAt: string | null
  roomName: string
  createdById: string
  transcript:   string | null
  summary:      string | null
  egressId:     string | null
  recordingKey: string | null
  createdAt:    string
  participants: MeetingParticipant[]
}

async function fetchMeetings() {
  const res = await fetch("/api/meetings")
  if (!res.ok) throw new Error("Erreur lors du chargement des réunions")
  return res.json() as Promise<Meeting[]>
}

async function createMeeting(data: {
  title: string
  description?: string
  scheduledAt?: string
  participantIds?: string[]
  instant?: boolean
}) {
  const res = await fetch("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création"))
  return res.json() as Promise<Meeting>
}

async function updateMeeting(id: string, data: Partial<{ status: string; endedAt: string; summary: string; transcript: string }>) {
  const res = await fetch(`/api/meetings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json() as Promise<Meeting>
}

async function deleteMeeting(id: string) {
  const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

async function fetchToken(meetingId: string, endpoint: string) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meetingId }),
  })
  if (!res.ok) throw new Error("Erreur lors de la génération du token")
  return res.json() as Promise<{ token: string; roomName: string; serverUrl: string }>
}

const QK = ["meetings"]

export function useMeetings() {
  return useQuery({ queryKey: QK, queryFn: fetchMeetings, staleTime: 0 })
}

export function useCreateMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createMeeting,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useUpdateMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateMeeting>[1] }) =>
      updateMeeting(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useDeleteMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteMeeting,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useMeetingToken(meetingId: string | null, endpoint = "/api/meetings/token") {
  return useQuery({
    queryKey: ["meeting-token", meetingId, endpoint],
    queryFn: () => fetchToken(meetingId!, endpoint),
    enabled: !!meetingId,
    staleTime: 1000 * 60 * 60 * 3,
  })
}
