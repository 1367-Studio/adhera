import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"

// FORM-7 "Pages" nav menus — named dropdowns an association creates to group several custom
// pages (SitePage.navMenuId) instead of giving each its own header button. See
// /api/site-nav-menus and src/lib/site-puck/site-page-nav.ts.

export type SiteNavMenuItem = {
  id:       string
  label:    string
  position: number
}

const SITE_NAV_MENUS_QUERY_KEY = ["site-nav-menus"]
const SITE_PAGES_QUERY_KEY     = ["site-pages"]

export function useSiteNavMenus() {
  return useQuery<SiteNavMenuItem[]>({
    queryKey: SITE_NAV_MENUS_QUERY_KEY,
    queryFn:  async () => {
      const response = await fetch("/api/site-nav-menus")
      if (!response.ok) throw await apiError(response, "Erreur lors du chargement des menus")
      const body = await response.json() as { siteNavMenus: SiteNavMenuItem[] }
      return body.siteNavMenus
    },
  })
}

export function useCreateSiteNavMenu() {
  const queryClient = useQueryClient()
  return useMutation<{ siteNavMenu: SiteNavMenuItem }, Error, { label: string }>({
    mutationFn: async newSiteNavMenu => {
      const response = await fetch("/api/site-nav-menus", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(newSiteNavMenu),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors de la création du menu")
      return response.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SITE_NAV_MENUS_QUERY_KEY }),
  })
}

export function useSaveSiteNavMenu() {
  const queryClient = useQueryClient()
  return useMutation<{ siteNavMenu: SiteNavMenuItem }, Error, { id: string; label?: string; position?: number }>({
    mutationFn: async ({ id, ...update }) => {
      const response = await fetch(`/api/site-nav-menus/${id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(update),
      })
      if (!response.ok) throw await apiError(response, "Erreur lors de l'enregistrement")
      return response.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SITE_NAV_MENUS_QUERY_KEY }),
  })
}

export function useDeleteSiteNavMenu() {
  const queryClient = useQueryClient()
  return useMutation<{ ok: true }, Error, string>({
    mutationFn: async id => {
      const response = await fetch(`/api/site-nav-menus/${id}`, { method: "DELETE" })
      if (!response.ok) throw await apiError(response, "Erreur lors de la suppression")
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SITE_NAV_MENUS_QUERY_KEY })
      // A deleted menu's pages fall back to their own header button (navMenuId cleared
      // server-side) — the pages list must reflect that immediately.
      queryClient.invalidateQueries({ queryKey: SITE_PAGES_QUERY_KEY })
    },
  })
}
