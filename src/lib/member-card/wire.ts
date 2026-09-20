// What a member card looks like once it has been through JSON, shared by the two client
// surfaces that read one over the wire: the member's own portal (use-portal-member-cards.ts)
// and the manager's modal (use-member-card.ts). Both routes answer with the same spread
// eligibility plus the same view model, so the shape they are parsed back into — and the
// parsing itself — belongs in one place rather than being spelled out twice.
//
// Type-only imports, deliberately: eligibility.ts reaches @prisma/client for MembreStatus and
// view-model.ts for the loader's row, and `import type` is erased at build time, so the shapes
// cross over while the database client never does — the same arrangement view-model.ts uses.
import type { MemberCardNoneReason, MemberCardUnavailableReason } from "@/lib/member-card/eligibility"
import type { MemberCardViewModel } from "@/lib/member-card/view-model"

/**
 * The wire form of MemberCardEligibility: same discriminated union, with its Dates as the ISO
 * strings JSON leaves behind. Narrowing on `state` is what each surface switches on to pick
 * between a card and an explanation.
 */
export type SerializedMemberCardEligibility =
  | { state: "valid";       validUntil: string; cotisationId: string }
  | { state: "unavailable"; reason: MemberCardUnavailableReason; cotisationId: string }
  | { state: "expired";     expiredOn:  string }
  | { state: "none";        reason: MemberCardNoneReason }

/** MemberCardViewModel as it survives JSON — see reviveMemberCard below. */
export type SerializedMemberCardViewModel = Omit<MemberCardViewModel, "validUntil"> & { validUntil: string }

// <MemberCard /> formats a real Date (with an explicit time zone, so the expiry it prints
// matches the server-rendered PDF and scan page). Reviving once, here, keeps that out of the
// pages and out of the renderer, which must not have to care where its view model came from.
export function reviveMemberCard(card: SerializedMemberCardViewModel | null): MemberCardViewModel | null {
  return card ? { ...card, validUntil: new Date(card.validUntil) } : null
}
