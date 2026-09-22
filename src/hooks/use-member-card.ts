import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiErrorMessage } from "@/lib/api-error"
import type { MemberCardViewModel } from "@/lib/member-card/view-model"
import {
  reviveMemberCard,
  type SerializedMemberCardEligibility,
  type SerializedMemberCardViewModel,
} from "@/lib/member-card/wire"

// The two French strings below are last-resort fallbacks, not UI copy: apiErrorMessage only
// falls back to them when the route answered without a readable `{ error }` of its own, and
// every one of these routes answers in French. Hardcoded here like every other hook in
// src/hooks (use-membres, use-fournisseurs, use-finance-categories…) rather than translated —
// a hook has no translator, and the components that *do* (member-card-actions, the modal's
// own feedback line) go through next-intl exactly as they should.

// Deliberately a child of the members key rather than a key of its own: recording a payment
// invalidates ["membres"] wholesale (see invalidateAll in use-cotisations.ts), and a card is
// exactly the thing a payment turns from "unavailable" into "valid". Sharing the prefix means
// an open card modal refreshes itself the moment the payment is saved.
const MEMBRES_QUERY_KEY = ["membres"]

function memberCardQueryKey(membreId: string) {
  return [...MEMBRES_QUERY_KEY, "carte", membreId]
}

/**
 * Cotisation still awaiting money, with the balance the payment modal needs. Non-null only
 * while the state is "unavailable" — the one case where the manager's next move is recording
 * the payment that turns the empty panel into a card.
 */
export type MemberCardPendingCotisation = {
  id:        string
  remaining: number
}

type MemberCardEntry = SerializedMemberCardEligibility & {
  card:              SerializedMemberCardViewModel | null
  pendingCotisation: MemberCardPendingCotisation | null
}

export type MemberCardQueryResult = SerializedMemberCardEligibility & {
  /** Non-null only for "valid" and "expired" — the states that have a card to print. */
  card:              MemberCardViewModel | null
  pendingCotisation: MemberCardPendingCotisation | null
}

/**
 * The member card as a manager sees it. `enabled` is what the modal passes its own `open`
 * flag to, so a members table of twenty rows doesn't fetch twenty cards it will never show.
 */
export function useMemberCard(membreId: string, enabled = true) {
  return useQuery<MemberCardQueryResult>({
    queryKey: memberCardQueryKey(membreId),
    queryFn:  async () => {
      const response = await fetch(`/api/membres/${membreId}/carte`)
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors du chargement de la carte"))
      const entry = await response.json() as MemberCardEntry
      return { ...entry, card: reviveMemberCard(entry.card) }
    },
    enabled: enabled && !!membreId,
  })
}

/**
 * Revokes the member's current QR code and mints a new one. Nothing is read back from the
 * response: invalidating the card query refetches it through the same route that built the
 * original card, so there is no second place deciding what a regenerated card looks like.
 */
export function useRotateMemberCardToken(membreId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/membres/${membreId}/carte/rotate`, { method: "POST" })
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Erreur lors de la régénération du QR code"))
      return response.json() as Promise<{ ok: true }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberCardQueryKey(membreId) })
      // The rotation is written to the activity log, which the member sheet's history tab
      // and the association-wide log both read.
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] })
      queryClient.invalidateQueries({ queryKey: ["membre-logs"] })
    },
  })
}
