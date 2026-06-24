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

export function useSaveSiteConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<SiteConfig> & { published?: boolean }) => {
      const res = await fetch("/api/site-config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Erreur lors de la sauvegarde")
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["site-config"] }),
  })
}
