import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { SiteConfig } from "@/types/site-config"

type SiteConfigData = {
  published: boolean
  slug:      string
  config:    SiteConfig | null
}

export function useSiteConfig() {
  return useQuery<SiteConfigData>({
    queryKey: ["site-config"],
    queryFn:  () => fetch("/api/site-config").then(r => r.json()),
  })
}

// sectionId → DonationForm id to show there, or null to leave the "dons" block empty. Applied
// to the forms themselves (their siteSectionId is the source of truth), never stored in
// siteConfig — see changedDonationFormAssignments in src/lib/dons/site-section-picks.ts.
export type DonsFormAssignments = Record<string, string | null>

export function useSaveSiteConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<SiteConfig> & { published?: boolean; donsFormAssignments?: DonsFormAssignments }) => {
      const res = await fetch("/api/site-config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Erreur lors de la sauvegarde")
      return res.json()
    },
    // Awaited before mutateAsync resolves: saving can rebind donation forms (assignments, or
    // a deleted "dons" section), and the builder drops its draft picks right after — the
    // refetched bindings must already be there so the preview doesn't flash the old state.
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ["site-config"] }),
      qc.invalidateQueries({ queryKey: ["activity-logs"] }),
      qc.invalidateQueries({ queryKey: ["donation-forms"] }),
      qc.invalidateQueries({ queryKey: ["site-preview-data"] }),
    ]),
  })
}
