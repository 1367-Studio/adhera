import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"
import type { BudgetPeriod } from "@/lib/finance/budget-shared"

export type BudgetExerciceOption = { id: string; label: string; startDate: string; endDate: string }
export type BudgetResponse = { exercices: BudgetExerciceOption[]; budget: BudgetPeriod | null }

async function fetchGlobalBudget(exerciceId: string): Promise<BudgetResponse> {
  const params = exerciceId ? `?exerciceId=${exerciceId}` : ""
  const res = await fetch(`/api/finances/budget${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

export function useGlobalBudget(exerciceId: string) {
  return useQuery({
    queryKey: ["budget-global", exerciceId],
    queryFn:  () => fetchGlobalBudget(exerciceId),
    staleTime: 30_000,
    // Keeps the previous exercice's table on screen while the next one loads instead of
    // flashing back to a skeleton on every Select change — same idiom as ReportsView.
    placeholderData: keepPreviousData,
  })
}

export type BudgetProjectSummary = {
  id:          string
  name:        string
  description: string | null
  archivedAt:  string | null
  createdAt:   string
  updatedAt:   string
}

async function fetchBudgetProjects(includeArchived: boolean): Promise<BudgetProjectSummary[]> {
  const res = await fetch(`/api/finances/budget/projects${includeArchived ? "?includeArchived=1" : ""}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

export function useBudgetProjects(includeArchived: boolean) {
  return useQuery({
    queryKey: ["budget-projects", includeArchived],
    queryFn:  () => fetchBudgetProjects(includeArchived),
  })
}

async function fetchProjectBudget(projectId: string, exerciceId: string): Promise<BudgetResponse> {
  const params = exerciceId ? `?exerciceId=${exerciceId}` : ""
  const res = await fetch(`/api/finances/budget/projects/${projectId}${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

export function useProjectBudget(projectId: string, exerciceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["budget-project", projectId, exerciceId],
    queryFn:  () => fetchProjectBudget(projectId, exerciceId),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled,
  })
}

function invalidateBudgets(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["budget-global"] }),
    qc.invalidateQueries({ queryKey: ["budget-project"] }),
  ])
}

export type BudgetLineUpsertInput = { exerciceId: string; categoryId: string; projectId?: string | null; amount: number }

async function upsertBudgetLine(data: BudgetLineUpsertInput) {
  const res = await fetch("/api/finances/budget/lines", {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

export function useUpsertBudgetLine() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: upsertBudgetLine, onSuccess: () => invalidateBudgets(qc) })
}

export type BudgetLineDeleteInput = { exerciceId: string; categoryId: string; projectId: string }

async function deleteBudgetLine(data: BudgetLineDeleteInput) {
  const res = await fetch("/api/finances/budget/lines", {
    method:  "DELETE",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

export function useDeleteBudgetLine() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteBudgetLine, onSuccess: () => invalidateBudgets(qc) })
}

export type BudgetProjectInput = { name: string; description?: string }

async function createBudgetProject(data: BudgetProjectInput): Promise<BudgetProjectSummary> {
  const res = await fetch("/api/finances/budget/projects", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

export function useCreateBudgetProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createBudgetProject,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["budget-projects"] }),
  })
}

export type BudgetProjectUpdateInput = { name?: string; description?: string; archived?: boolean }

async function updateBudgetProject(id: string, data: BudgetProjectUpdateInput): Promise<BudgetProjectSummary> {
  const res = await fetch(`/api/finances/budget/projects/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

export function useUpdateBudgetProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: BudgetProjectUpdateInput }) => updateBudgetProject(id, data),
    onSuccess:  () => Promise.all([
      qc.invalidateQueries({ queryKey: ["budget-projects"] }),
      invalidateBudgets(qc),
    ]),
  })
}

export type BudgetCopyInput = { targetExerciceId: string; projectIds: "all" | string[]; confirmOverwrite?: boolean }

// On a 409 conflict, throws an ApiError whose `.details.conflict` is true — same
// confirm-then-retry idiom as the exercice gap/early-closure flows (see ApiError's own doc
// comment) — the caller catches it, shows a confirmation, and retries with confirmOverwrite.
async function copyBudget(data: BudgetCopyInput) {
  const res = await fetch("/api/finances/budget/copy", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la copie")
  return res.json() as Promise<{ copied: number }>
}

export function useCopyBudget() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: copyBudget, onSuccess: () => invalidateBudgets(qc) })
}
