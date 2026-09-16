import { useQuery } from "@tanstack/react-query"
import type { DonationFormPlacement } from "@/lib/dons/site-section-picks"

// Same key as the dons dashboard's own list query, so publishing/archiving a form there
// refreshes the site builder (and vice versa) without extra invalidation. Typed down to the
// placement fields the site builder needs; the response carries the full rows.
export function useDonationForms({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<DonationFormPlacement[]>({
    queryKey: ["donation-forms"],
    queryFn:  async () => {
      const response = await fetch("/api/donation-forms")
      if (!response.ok) throw new Error("Erreur lors du chargement des formulaires de don")
      return response.json()
    },
    enabled,
  })
}
