import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"
import type { SitePuckData } from "@/lib/site-puck/site-puck-data"

// FORM-7 website builder draft (Association.siteDraft) — see /api/site-draft.

const SITE_DRAFT_QUERY_KEY = ["site-draft"]

type SiteDraftResponse = { draft: SitePuckData | null }

export function useSiteDraft() {
  return useQuery<SiteDraftResponse>({
    queryKey: SITE_DRAFT_QUERY_KEY,
    queryFn:  async () => {
      const response = await fetch("/api/site-draft")
      if (!response.ok) throw await apiError(response, "Erreur lors du chargement du brouillon")
      return response.json()
    },
    // The editor reads it once on mount; a background refetch must never replace the page
    // being edited.
    staleTime:            Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useSaveSiteDraft() {
  const queryClient = useQueryClient()
  return useMutation<{ ok: true; savedAt: string }, Error, SitePuckData>({
    mutationFn: async siteDraft => {
      const response = await fetch("/api/site-draft", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(siteDraft),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors de l'enregistrement")
      return response.json()
    },
    onSuccess: (_result, savedDraft) => {
      queryClient.setQueryData<SiteDraftResponse>(SITE_DRAFT_QUERY_KEY, { draft: savedDraft })
    },
  })
}
