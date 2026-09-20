import { loadMemberCardEligibility } from "@/lib/member-card/loader"

// True only when the member's card actually exists right now: the association turned the card
// on, the member is active, and a PAYE/EXONERE cotisation covers today (full precedence in
// getMemberCardEligibility). Meant for the transactional emails, which must decide whether to
// show a "Voir ma carte de membre" button — linking to a card the member can't see yet reads
// as a broken promise, and "the cotisation is paid" is *not* the same rule (a suspended member
// or an association that never enabled the card both pay just the same). Asking the shared
// loader rather than re-reading a status locally is what keeps that rule in one place.
//
// Never throws and never creates anything: a confirmation email matters more than its card
// button, so a failing lookup — or a member that no longer exists — is logged and treated as
// "no card". The card's QR token stays unminted too (ensureMemberCardToken), since the button
// points at the member's own portal page, not at the public scan URL.
export async function isMemberCardAvailable(associationId: string, membreId: string): Promise<boolean> {
  try {
    const memberCard = await loadMemberCardEligibility(associationId, membreId)
    return memberCard?.eligibility.state === "valid"
  } catch (error) {
    console.error(`[member-card] eligibility lookup failed for membre ${membreId} (association ${associationId}):`, error)
    return false
  }
}
