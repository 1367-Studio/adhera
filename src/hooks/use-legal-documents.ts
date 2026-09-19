import { useQuery } from "@tanstack/react-query"
import type { RequiredLegalDocument } from "@/components/public/legal-consent"
import { BASE_PATH } from "@/lib/env"

// Documents the association requires agreement to, for dashboard screens where a manager acts
// on someone else's behalf. Public forms never use this: they receive the list as a prop from
// their server page, so the consent box cannot go missing because a request failed.
//
// BASE_PATH prefix: the app is served under /app and a bare "/api/…" resolves against the
// origin root, where Next has no route.
export function useRequiredLegalDocuments() {
  return useQuery({
    queryKey: ["legal-required-documents"],
    queryFn:  async (): Promise<RequiredLegalDocument[]> => {
      const response = await fetch(`${BASE_PATH}/api/legal/required`)
      if (!response.ok) return []
      const data = await response.json()
      return data.documents ?? []
    },
    staleTime: 5 * 60_000,
  })
}
