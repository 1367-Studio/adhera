import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"
import type { SitePageContent } from "@/lib/site-puck/site-page-schema"

// FORM-7 custom pages — one more page on the new builder's site beyond the single home page
// (use-site-draft.ts). See /api/site-pages.

export type SitePageStatus     = "DRAFT" | "PUBLISHED"

export type SitePageListItem = {
  id:          string
  title:       string
  slug:        string
  status:      SitePageStatus
  showInNav:   boolean
  navLabel:    string | null
  navPosition: number
  // Which named dropdown (SiteNavMenu) this page is grouped into — null means its own header
  // button, like the existing headerLinks. See use-site-nav-menus.ts.
  navMenuId:   string | null
  publishedAt: string | null
  updatedAt:   string
}

export type SitePageDetail = SitePageListItem & {
  draftContent:     SitePageContent
  publishedContent: SitePageContent | null
  seoTitle:         string | null
  seoDescription:   string | null
  createdAt:        string
}

const SITE_PAGES_QUERY_KEY = ["site-pages"]
const sitePageQueryKey = (id: string) => ["site-pages", id]

export function useSitePages() {
  return useQuery<SitePageListItem[]>({
    queryKey: SITE_PAGES_QUERY_KEY,
    queryFn:  async () => {
      const response = await fetch("/api/site-pages")
      if (!response.ok) throw await apiError(response, "Erreur lors du chargement des pages")
      const body = await response.json() as { sitePages: SitePageListItem[] }
      return body.sitePages
    },
  })
}

export function useSitePage(id: string, options: { enabled?: boolean } = {}) {
  return useQuery<SitePageDetail>({
    queryKey: sitePageQueryKey(id),
    queryFn:  async () => {
      const response = await fetch(`/api/site-pages/${id}`)
      if (!response.ok) throw await apiError(response, "Erreur lors du chargement de la page")
      const body = await response.json() as { sitePage: SitePageDetail }
      return body.sitePage
    },
    enabled:              options.enabled ?? true,
    // Loaded once into the Puck editor on mount — a background refetch must never replace the
    // page being edited (same reasoning as useSiteDraft).
    staleTime:            Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useCreateSitePage() {
  const queryClient = useQueryClient()
  return useMutation<{ sitePage: SitePageDetail }, Error, { title: string; slug: string }>({
    mutationFn: async newSitePage => {
      const response = await fetch("/api/site-pages", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(newSitePage),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors de la création de la page")
      return response.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SITE_PAGES_QUERY_KEY }),
  })
}

type SaveSitePageInput = {
  title?:          string
  seoTitle?:       string | null
  seoDescription?: string | null
  showInNav?:      boolean
  navLabel?:       string | null
  navPosition?:    number
  navMenuId?:      string | null
  content?:        SitePageContent["content"]
  zones?:          SitePageContent["zones"]
}

export function useSaveSitePage(id: string) {
  const queryClient = useQueryClient()
  return useMutation<{ sitePage: SitePageDetail }, Error, SaveSitePageInput>({
    mutationFn: async update => {
      const response = await fetch(`/api/site-pages/${id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(update),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors de l'enregistrement")
      return response.json()
    },
    onSuccess: ({ sitePage }) => {
      queryClient.setQueryData(sitePageQueryKey(id), sitePage)
      queryClient.invalidateQueries({ queryKey: SITE_PAGES_QUERY_KEY })
    },
  })
}

export function usePublishSitePage(id: string) {
  const queryClient = useQueryClient()
  return useMutation<{ ok: true; publishedAt: string; status: SitePageStatus }, Error, SitePageContent>({
    mutationFn: async content => {
      const response = await fetch(`/api/site-pages/${id}/publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(content),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors de la publication")
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sitePageQueryKey(id) })
      queryClient.invalidateQueries({ queryKey: SITE_PAGES_QUERY_KEY })
    },
  })
}

export function useUnpublishSitePage(id: string) {
  const queryClient = useQueryClient()
  return useMutation<{ ok: true; status: SitePageStatus }, Error, void>({
    mutationFn: async () => {
      const response = await fetch(`/api/site-pages/${id}/unpublish`, { method: "POST" })
      if (!response.ok) throw await apiError(response, "Erreur lors de la dépublication")
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sitePageQueryKey(id) })
      queryClient.invalidateQueries({ queryKey: SITE_PAGES_QUERY_KEY })
    },
  })
}

export function useDeleteSitePage() {
  const queryClient = useQueryClient()
  return useMutation<{ ok: true }, Error, string>({
    mutationFn: async id => {
      const response = await fetch(`/api/site-pages/${id}`, { method: "DELETE" })
      if (!response.ok) throw await apiError(response, "Erreur lors de la suppression")
      return response.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SITE_PAGES_QUERY_KEY }),
  })
}
