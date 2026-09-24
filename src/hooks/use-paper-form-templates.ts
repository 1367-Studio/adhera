import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type {
  PaperFormTemplateInput,
  PaperFormTemplateUpdateInput,
  PaperFormTemplateResponse,
  PaperFormAnalyzeRequest,
  PaperFormAnalyzeResponse,
} from "@/lib/schemas"
import { apiError } from "@/lib/api-error"

const PAPER_FORM_TEMPLATES_QUERY_KEY = ["paper-form-templates"]

export type PaperFormTemplate = PaperFormTemplateResponse

async function fetchPaperFormTemplates(): Promise<PaperFormTemplate[]> {
  const response = await fetch("/api/membres/paper-forms")
  if (!response.ok) throw await apiError(response, "Erreur lors du chargement des modèles")
  return response.json()
}

async function fetchPaperFormTemplate(templateId: string): Promise<PaperFormTemplate> {
  const response = await fetch(`/api/membres/paper-forms/${templateId}`)
  if (!response.ok) throw await apiError(response, "Erreur lors du chargement du modèle")
  return response.json()
}

async function createPaperFormTemplate(data: PaperFormTemplateInput): Promise<PaperFormTemplate> {
  const response = await fetch("/api/membres/paper-forms", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!response.ok) throw await apiError(response, "Erreur lors de la création")
  return response.json()
}

async function updatePaperFormTemplate(templateId: string, data: PaperFormTemplateUpdateInput): Promise<PaperFormTemplate> {
  const response = await fetch(`/api/membres/paper-forms/${templateId}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!response.ok) throw await apiError(response, "Erreur lors de la mise à jour")
  return response.json()
}

async function deletePaperFormTemplate(templateId: string) {
  const response = await fetch(`/api/membres/paper-forms/${templateId}`, { method: "DELETE" })
  if (!response.ok) throw await apiError(response, "Erreur lors de la suppression")
}

async function analyzePaperForm(data: PaperFormAnalyzeRequest): Promise<PaperFormAnalyzeResponse> {
  const response = await fetch("/api/membres/paper-forms/analyze", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!response.ok) throw await apiError(response, "Erreur lors de l'analyse du formulaire")
  return response.json()
}

export function usePaperFormTemplates() {
  return useQuery({
    queryKey:  PAPER_FORM_TEMPLATES_QUERY_KEY,
    queryFn:   fetchPaperFormTemplates,
    staleTime: 0,
  })
}

// Same opt-out as useAssociationDocument: a background refetch in the mapping editor would
// only risk replacing the template under unsaved edits.
export function usePaperFormTemplate(templateId: string, options?: { refetchOnWindowFocus?: boolean }) {
  return useQuery({
    queryKey: [...PAPER_FORM_TEMPLATES_QUERY_KEY, "detail", templateId],
    queryFn:  () => fetchPaperFormTemplate(templateId),
    enabled:  !!templateId,
    ...(options?.refetchOnWindowFocus !== undefined ? { refetchOnWindowFocus: options.refetchOnWindowFocus } : {}),
  })
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: PAPER_FORM_TEMPLATES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useCreatePaperFormTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createPaperFormTemplate,
    onSuccess:  () => invalidateAll(queryClient),
  })
}

export function useUpdatePaperFormTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, data }: { templateId: string; data: PaperFormTemplateUpdateInput }) => updatePaperFormTemplate(templateId, data),
    onSuccess:  () => invalidateAll(queryClient),
  })
}

export function useDeletePaperFormTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deletePaperFormTemplate,
    onSuccess:  (_result, templateId) => {
      queryClient.removeQueries({ queryKey: [...PAPER_FORM_TEMPLATES_QUERY_KEY, "detail", templateId] })
      return invalidateAll(queryClient)
    },
  })
}

// A proposal only — nothing is saved, so no cache to invalidate.
export function useAnalyzePaperForm() {
  return useMutation({ mutationFn: analyzePaperForm })
}
