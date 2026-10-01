import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"
import type { SiteBuilder } from "@/hooks/use-site-draft"

// The site blocks a membership or donation form can be published on — from whichever builder
// the public site currently renders (siteConfig sections, or the new builder's blocks).
// See /api/site-sections.

export type SiteSectionType = "membership" | "dons"

export type SiteSectionSummary = { id: string; title: string }

type SiteSectionsResponse = {
  siteBuilder: SiteBuilder
  sections:    SiteSectionSummary[]
}

const SITE_SECTIONS_QUERY_KEY = ["site-sections"]

export function useSiteSections(sectionType: SiteSectionType) {
  return useQuery<SiteSectionsResponse>({
    queryKey: [...SITE_SECTIONS_QUERY_KEY, sectionType],
    queryFn:  async () => {
      const response = await fetch(`/api/site-sections?type=${sectionType}`)
      if (!response.ok) throw await apiError(response, "Erreur lors du chargement des sections du site")
      return response.json()
    },
  })
}

export function useCreateSiteSection() {
  const queryClient = useQueryClient()
  return useMutation<SiteSectionSummary, Error, SiteSectionType>({
    mutationFn: async sectionType => {
      const response = await fetch("/api/site-sections", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: sectionType }),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors de la création de la section du site")
      return response.json()
    },
    // Awaited so the new section is already in the picker's options when it gets selected.
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: SITE_SECTIONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["site-config"] }),
      queryClient.invalidateQueries({ queryKey: ["site-draft"] }),
    ]),
  })
}
