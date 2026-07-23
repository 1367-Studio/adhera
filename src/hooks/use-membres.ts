import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { MembreCreateInput, MembreUpdateInput } from "@/lib/schemas"
import type { PaginatedResult } from "@/lib/pagination"
import { apiErrorMessage, apiError } from "@/lib/api-error"

export type MembreDetail = {
  id:            string
  firstName:     string
  lastName:      string
  email:         string | null
  phone:         string | null
  birthDate:     string | null
  address:       string | null
  civilite:      "MME" | "MLLE" | "M" | null
  sexe:          "HOMME" | "FEMME" | null
  groupeSanguin: "A_POSITIF" | "A_NEGATIF" | "B_POSITIF" | "B_NEGATIF" | "AB_POSITIF" | "AB_NEGATIF" | "O_POSITIF" | "O_NEGATIF" | null
  allergies:     string | null
  photoUrl:      string | null
  status:        "PENDING" | "ACTIF" | "INACTIF" | "SUSPENDU"
  typeId:        string | null
  associationId: string | null
  userId:        string | null
  joinedAt:      string
  createdAt:     string
  updatedAt:     string | null
  deletedAt:     string | null
  termsAcceptedAt: string | null
  termsVersion:    string | null
  termsAcceptedIp: string | null
  cotisations: {
    id:     string
    year:   number
    amount: string
    status: "EN_ATTENTE" | "PAYE" | "EXONERE"
    paidAt: string | null
  }[]

  participations: {
    id:          string
    evenementId: string
    present:     boolean
    rsvp:        "CONFIRME" | "PROVAVEL" | "INCERTO" | "ABSENT" | null
    evenement: {
      id:          string
      title:       string
      description: string | null
      date:        string
    }
  }[]

  materialLoans: {
    id:           string
    status:       "DEMANDE" | "CONFIRME" | "REFUSE"
    quantity:     number
    borrowedAt:   string
    returnedAt:   string | null
    material: {
      id:   string
      name: string
    }
  }[]

  meetingsAsParticipant: {
    id:       string
    joinedAt: string | null
    meeting: {
      id:          string
      title:       string
      status:      "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED"
      scheduledAt: string | null
      createdAt:   string
    }
  }[]

  type: {
    id:    string
    name:  string
    color: string
  } | null

  user: {
    role: "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE"
  } | null

  _count: {
    cotisations:    number
    participations: number
    materialLoans:  number
    meetingsAsParticipant: number
  }
}

const QK = ["membres"]

async function fetchMembresPaginated(page: number, limit: number, search?: string, status?: string, typeId?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) params.set("search", search)
  if (status) params.set("status", status)
  if (typeId) params.set("typeId", typeId)
  const res = await fetch(`/api/membres?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des membres")
  return res.json() as Promise<PaginatedResult<unknown>>
}

async function fetchMembre(id: string) {
  const res = await fetch(`/api/membres/${id}`)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement du membre"))
  return res.json()
}

export function useMembre(id: string) {
  return useQuery<MembreDetail>({
    queryKey: [...QK, "detail", id],
    queryFn:  () => fetchMembre(id),
    enabled:  !!id,
  })
}

async function createMembre(data: MembreCreateInput) {
  const res = await fetch("/api/membres", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateMembre(id: string, data: MembreUpdateInput) {
  const res = await fetch(`/api/membres/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la mise à jour"))
  return res.json()
}

async function deleteMembre(id: string) {
  const res = await fetch(`/api/membres/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la suppression"))
}

export function useMembresPaginated(page: number, limit = 20, search?: string, status?: string, typeId?: string) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, search, status, typeId],
    queryFn:   () => fetchMembresPaginated(page, limit, search, status, typeId),
    staleTime: 0,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["membres-active"] }),
    qc.invalidateQueries({ queryKey: ["dashboard"] }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
    qc.invalidateQueries({ queryKey: ["membre-logs"] }),
  ])
}

export function useCreateMembre() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createMembre,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateMembre(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: MembreUpdateInput) => updateMembre(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteMembre() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteMembre,
    onSuccess: () => invalidateAll(qc),
  })
}

async function changeRole(id: string, role: string) {
  const res = await fetch(`/api/membres/${id}/role`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ role }),
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du changement de rôle"))
}

export function useChangeRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => changeRole(id, role),
    onSuccess:  () => invalidateAll(qc),
  })
}

async function createAccess(id: string) {
  const res = await fetch(`/api/membres/${id}/create-access`, { method: "POST" })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors de la création de l'accès"))
}

export function useCreateAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createAccess,
    onSuccess:  () => invalidateAll(qc),
  })
}
