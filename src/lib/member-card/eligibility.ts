import type { MembreStatus } from "@prisma/client"
import type { CotisationStatus } from "@/lib/cotisation-status"
import {
  ADHERENT_STATUSES,
  cotisationCoversDate,
  cotisationPeriodIncludesDate,
  endOfCotisationYear,
  startOfCotisationYear,
} from "@/lib/membre-adherent"

// Whether a member's digital card is VALID is always computed live from this pure function,
// never stored: a payment landing, a refund, a cotisation being cancelled or a member being
// suspended must all be reflected the next time the card is shown or scanned, with no
// status column that some code path could forget to update. Pure (no Prisma, only a type
// import) so the dashboard, the portal and the public scan page can all call it, client-side
// included, and so it can be unit-tested without a database — the loader that feeds it lives
// in src/lib/member-card/loader.ts.
//
// Unlike isMembreAdherent (src/lib/membre-adherent.ts), the card deliberately ignores
// adherentOverride and never inherits from a responsable: a card is proof that *this* person
// holds a paid (or exempted) membership, which a manual badge override or a parent's
// cotisation doesn't establish. Both still share cotisationCoversDate for the per-row rule, so
// a row that makes someone adhérent is exactly a row that makes their card valid.
//
// Token revocation isn't an input here: rotating a card (rotateMemberCardToken in token.ts)
// replaces Membre.cardToken outright, so a revoked token simply stops resolving to any member
// at lookup time and never reaches this function.

export type MemberCardCotisation = {
  id:          string
  year:        number
  status:      CotisationStatus
  // Strings accepted for the same reason as in membre-adherent.ts: a client-side caller gets
  // Date columns as ISO strings from JSON.
  periodStart: Date | string | null
  periodEnd:   Date | string | null
}

export type MemberCardEligibilityInput = {
  // Already resolved from Association.memberCardSettings via parseMemberCardSettings — kept
  // as a bare flag so this function doesn't depend on the settings' shape.
  cardEnabled: boolean
  membre:      { status: MembreStatus; deletedAt: Date | string | null }
  // Every cotisation of this member (not their responsable's) — past rows are needed to tell
  // "expired" from "never had one", so the caller must not pre-filter to the current year.
  cotisations: readonly MemberCardCotisation[]
}

export type MemberCardUnavailableReason = "pending" | "partial" | "late"
export type MemberCardNoneReason = "disabled" | "inactive-member" | "cancelled" | "no-membership"

export type MemberCardEligibility =
  // cotisationId = the covering row whose period ends last (the one validUntil comes from).
  | { state: "valid"; validFrom: Date; validUntil: Date; cotisationId: string }
  // cotisationId = the current-period row still waiting on money, so the UI can link to its
  // payment without re-deriving which row that is.
  | { state: "unavailable"; reason: MemberCardUnavailableReason; cotisationId: string }
  // cotisationId = the past PAYE/EXONERE row whose expiry is printed — lets the view model
  // read which MembershipTier produced it (see Cotisation.tierId), same as "valid" above.
  | { state: "expired"; expiredOn: Date; cotisationId: string }
  | { state: "none"; reason: MemberCardNoneReason }

// Most urgent first — when a member somehow has several unpaid rows for the current period,
// the card surfaces the one needing action soonest: an overdue row, then one already partly
// paid (closest to unlocking the card), then a plain pending one.
const UNAVAILABLE_REASON_ORDER: readonly { status: CotisationStatus; reason: MemberCardUnavailableReason }[] = [
  { status: "EN_RETARD",           reason: "late"    },
  { status: "PARTIELLEMENT_PAYEE", reason: "partial" },
  { status: "EN_ATTENTE",          reason: "pending" },
]

// When a row stops covering: its own periodEnd for a custom-duration tier, otherwise the end
// of its calendar year in Paris time — the same boundary currentCotisationYear() flips at.
function cotisationEndDate(cotisation: MemberCardCotisation): Date {
  return cotisation.periodEnd ? new Date(cotisation.periodEnd) : endOfCotisationYear(cotisation.year)
}

// Mirror of cotisationEndDate for the start of the period: a custom-duration tier's own
// periodStart, otherwise 1 Jan of its calendar year — the "carte valable du {from} au {to}"
// line's other half.
function cotisationStartDate(cotisation: MemberCardCotisation): Date {
  return cotisation.periodStart ? new Date(cotisation.periodStart) : startOfCotisationYear(cotisation.year)
}

function latestEnding(cotisations: readonly MemberCardCotisation[]): MemberCardCotisation {
  return cotisations.reduce((latest, candidate) =>
    cotisationEndDate(candidate) > cotisationEndDate(latest) ? candidate : latest,
  )
}

// Precedence, first match wins:
//   1. disabled        — the association turned the card off: nothing about the member is
//                        shown, whatever their cotisations say.
//   2. inactive-member — soft-deleted, or any status but ACTIF (PENDING, INACTIF, SUSPENDU):
//                        a manager's suspension must beat a paid cotisation, otherwise
//                        suspending someone would leave them a valid card until December.
//   3. valid           — at least one own PAYE/EXONERE row covers now. Checked before the
//                        unpaid states so a renewal row created early (EN_ATTENTE for the new
//                        season) never hides a previous season still covering via periodEnd.
//   4. unavailable     — no covering row, but a current-period row is waiting on money: the
//                        most actionable message ("payez pour activer votre carte").
//   5. cancelled       — the current-period row was cancelled (ANNULEE). Below unavailable so
//                        a cancelled duplicate next to a live unpaid row still points to the
//                        live one; above expired because "your membership for this season was
//                        cancelled" is more accurate than "expired on 31/12" of a past season.
//   6. expired         — nothing current, but a PAYE/EXONERE row ended in the past.
//   7. no-membership   — nothing current and nothing paid in the past. A calendar-year row
//                        paid ahead for next year counts for neither 3 nor 6 — the adhérent
//                        badge ignores it too — so on its own it lands here.
export function getMemberCardEligibility(input: MemberCardEligibilityInput, now: Date = new Date()): MemberCardEligibility {
  if (!input.cardEnabled) return { state: "none", reason: "disabled" }
  if (input.membre.deletedAt || input.membre.status !== "ACTIF") return { state: "none", reason: "inactive-member" }

  const coveringCotisations = input.cotisations.filter(cotisation => cotisationCoversDate(cotisation, now))
  if (coveringCotisations.length > 0) {
    const longestCovering = latestEnding(coveringCotisations)
    return {
      state:        "valid",
      validFrom:    cotisationStartDate(longestCovering),
      validUntil:   cotisationEndDate(longestCovering),
      cotisationId: longestCovering.id,
    }
  }

  const currentCotisations = input.cotisations.filter(cotisation => cotisationPeriodIncludesDate(cotisation, now))
  for (const { status, reason } of UNAVAILABLE_REASON_ORDER) {
    const awaitingPayment = currentCotisations.filter(cotisation => cotisation.status === status)
    if (awaitingPayment.length > 0) {
      return { state: "unavailable", reason, cotisationId: latestEnding(awaitingPayment).id }
    }
  }
  if (currentCotisations.some(cotisation => cotisation.status === "ANNULEE")) {
    return { state: "none", reason: "cancelled" }
  }

  // Filtered on the end date rather than "not covering", so a PAYE row for next year (end
  // still in the future) isn't mistaken for an expired one.
  const pastPaidCotisations = input.cotisations.filter(cotisation =>
    ADHERENT_STATUSES.includes(cotisation.status) && cotisationEndDate(cotisation) < now,
  )
  if (pastPaidCotisations.length > 0) {
    const lastCovering = latestEnding(pastPaidCotisations)
    return { state: "expired", expiredOn: cotisationEndDate(lastCovering), cotisationId: lastCovering.id }
  }

  return { state: "none", reason: "no-membership" }
}
