import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"
import type { AccessArea, AccessLevel, ResolvedPermissions } from "@/lib/permissions"

export type TeamRole = "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "EQUIPE"
export type TeamAssignableRole = TeamRole | "MEMBRE"

export type TeamMember = {
  userId:      string
  membreId:    string | null
  name:        string
  email:       string
  role:        TeamRole
  // User.permissions is set: access no longer follows the role's profile.
  isCustom:    boolean
  permissions: ResolvedPermissions
}

export type TeamMemberUpdate = {
  role?:        TeamAssignableRole
  // null = back to the profile of the role.
  permissions?: { administrator: boolean; areas: Record<AccessArea, AccessLevel> } | null
}

const TEAM_ACCESS_QUERY_KEY = ["team-access"] as const

export function useTeamAccess(enabled = true) {
  return useQuery<TeamMember[]>({
    queryKey: TEAM_ACCESS_QUERY_KEY,
    enabled,
    queryFn:  async () => {
      const response = await fetch("/api/equipe")
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors du chargement de l'équipe"))
      return response.json()
    },
  })
}

export function useUpdateTeamMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, update }: { userId: string; update: TeamMemberUpdate }) => {
      const response = await fetch(`/api/equipe/${userId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(update),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors de l'enregistrement"))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEAM_ACCESS_QUERY_KEY })
      // The role shows in the Membres list and on the member's page too.
      queryClient.invalidateQueries({ queryKey: ["membres"] })
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] })
      queryClient.invalidateQueries({ queryKey: ["membre-logs"] })
    },
  })
}
