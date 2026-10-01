import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"
import type { SitePuckData } from "@/lib/site-puck/site-puck-data"

// FORM-7 website builder draft (Association.siteDraft) — see /api/site-draft. Publishing copies
// it to the version visitors see once the association switches its site to the new builder
// (siteBuilder "PUCK", see /api/site-builder).

const SITE_DRAFT_QUERY_KEY = ["site-draft"]

export type SiteBuilder = "LEGACY" | "PUCK"

export type SiteDraftResponse = {
  draft:       SitePuckData | null
  // When the last version was published from the new builder; null = never published.
  publishedAt: string | null
  siteBuilder: SiteBuilder
}

export function useSiteDraft(options: { enabled?: boolean } = {}) {
  return useQuery<SiteDraftResponse>({
    queryKey: SITE_DRAFT_QUERY_KEY,
    queryFn:  async () => {
      const response = await fetch("/api/site-draft")
      if (!response.ok) throw await apiError(response, "Erreur lors du chargement du brouillon")
      return response.json()
    },
    enabled: options.enabled ?? true,
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
      queryClient.setQueryData<SiteDraftResponse>(SITE_DRAFT_QUERY_KEY, previousResponse =>
        previousResponse ? { ...previousResponse, draft: savedDraft } : previousResponse)
    },
  })
}

// Saves the page as the draft and publishes it in one request.
export function usePublishSiteDraft() {
  const queryClient = useQueryClient()
  return useMutation<{ ok: true; publishedAt: string }, Error, SitePuckData>({
    mutationFn: async siteDraft => {
      const response = await fetch("/api/site-draft/publish", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(siteDraft),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors de la publication")
      return response.json()
    },
    onSuccess: (publishResult, publishedDraft) => {
      queryClient.setQueryData<SiteDraftResponse>(SITE_DRAFT_QUERY_KEY, previousResponse =>
        previousResponse
          ? { ...previousResponse, draft: publishedDraft, publishedAt: publishResult.publishedAt }
          : previousResponse)
    },
  })
}

// Which builder the public site renders. Switching to "PUCK" is refused (409) while nothing has
// been published from the new builder.
export function useSetSiteBuilder() {
  const queryClient = useQueryClient()
  return useMutation<{ siteBuilder: SiteBuilder }, Error, SiteBuilder>({
    mutationFn: async siteBuilder => {
      const response = await fetch("/api/site-builder", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ siteBuilder }),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors du changement d'éditeur")
      return response.json()
    },
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: SITE_DRAFT_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["site-config"] }),
      queryClient.invalidateQueries({ queryKey: ["site-sections"] }),
    ]),
  })
}
