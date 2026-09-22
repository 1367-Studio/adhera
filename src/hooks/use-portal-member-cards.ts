import { useQuery } from "@tanstack/react-query"
import type { MemberCardViewModel } from "@/lib/member-card/view-model"
import {
  reviveMemberCard,
  type SerializedMemberCardEligibility,
  type SerializedMemberCardViewModel,
} from "@/lib/member-card/wire"
import { portalFetch } from "@/lib/portal-fetch"

const PORTAL_MEMBER_CARDS_QUERY_KEY = ["portal", "member-cards"]

type PortalMemberCardIdentity = {
  membreId:    string
  firstName:   string
  lastName:    string
  /** "Camille Martin" — the same spelling the card itself prints. */
  displayName: string
}

type PortalMemberCardEntry = PortalMemberCardIdentity
  & { card: SerializedMemberCardViewModel | null }
  & SerializedMemberCardEligibility

/** One person of the household — the logged-in member, or someone they are responsible for. */
export type PortalMemberCard = PortalMemberCardIdentity
  & { card: MemberCardViewModel | null }
  & SerializedMemberCardEligibility

// GET /api/portal/carte answers with the logged-in member's card and their dependants' — the
// route decides who that is, the client never names anyone.
export function usePortalMemberCards() {
  return useQuery({
    queryKey: PORTAL_MEMBER_CARDS_QUERY_KEY,
    queryFn:  async (): Promise<PortalMemberCard[]> => {
      const entries = await portalFetch("/api/portal/carte") as PortalMemberCardEntry[]
      return entries.map(entry => ({ ...entry, card: reviveMemberCard(entry.card) }))
    },
  })
}
