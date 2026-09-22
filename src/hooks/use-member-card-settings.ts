import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"
import type { MemberCardSettings } from "@/lib/member-card/settings"

// Its own key rather than a slice of ["association"]: the card settings live in a Json column
// that the association endpoint deliberately doesn't expose, and saving them must not
// invalidate (and refetch) the whole association screen.
const MEMBER_CARD_SETTINGS_QUERY_KEY = ["association-member-card"]

export function useMemberCardSettings() {
  return useQuery<MemberCardSettings>({
    queryKey: MEMBER_CARD_SETTINGS_QUERY_KEY,
    queryFn:  async () => {
      const res = await fetch("/api/association/member-card")
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
  })
}

export function useUpdateMemberCardSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (settings: MemberCardSettings) => {
      const res = await fetch("/api/association/member-card", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(settings),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json() as Promise<MemberCardSettings>
    },
    onSuccess: (saved) => {
      // The route answers with what it stored, so seed the cache with it and let the
      // activity log (Paramètres → historique) pick up the write on its own.
      queryClient.setQueryData(MEMBER_CARD_SETTINGS_QUERY_KEY, saved)
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] })
    },
  })
}
