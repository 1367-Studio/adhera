import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"

const QK = ["exercices"]

export type ExerciceStatus = "OUVERT" | "CLOTURE"

export type Exercice = {
  id:        string
  label:     string
  startDate: string
  endDate:   string
  status:    ExerciceStatus
  closedAt:  string | null
}

export type ExerciceInput = {
  label:      string
  startDate:  string
  endDate:    string
  confirmGap?: boolean
}

export type ExerciceUpdateInput = {
  label?:  string
  status?: ExerciceStatus
  confirmEarlyClosure?: boolean
}

async function fetchExercices(): Promise<Exercice[]> {
  const res = await fetch("/api/finances/exercices")
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

async function createExercice(data: ExerciceInput) {
  const res = await fetch("/api/finances/exercices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateExercice(id: string, data: ExerciceUpdateInput): Promise<Exercice & { linkedRecords: number }> {
  const res = await fetch(`/api/finances/exercices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

async function deleteExercice(id: string) {
  const res = await fetch(`/api/finances/exercices/${id}`, { method: "DELETE" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: QK })
}

export function useExercices() {
  return useQuery({ queryKey: QK, queryFn: fetchExercices, staleTime: 0 })
}

export function useCreateExercice() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createExercice, onSuccess: () => invalidateAll(qc) })
}

// Unlike useUpdateBankAccount(id), this doesn't bind a single id — a table row can
// trigger this action on any exercice directly (close/reopen), not just one held in
// "edit target" state, so the id travels with each call instead.
export function useUpdateExercice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ExerciceUpdateInput }) => updateExercice(id, data),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteExercice() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteExercice, onSuccess: () => invalidateAll(qc) })
}
