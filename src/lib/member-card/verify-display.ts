import { APP_TIME_ZONE } from "@/lib/date-format"
import type { MemberCardData } from "@/lib/member-card/loader"

// Everything the public /carte/[token] page is allowed to put on screen, derived once from
// what the loader read. The whole point is the shape: the "invalid" variant carries no
// fields at all, so the page *cannot* render a name, an association or a category in that
// state even by accident — tsc rejects it.
//
// That matters because loadMemberCardEligibility deliberately returns the member's display
// data whatever the eligibility state (its callers have different rights), while an
// anonymous person scanning a QR code must not be able to learn that a given token maps to
// a real human whose cotisation is unpaid, cancelled or whose association switched the card
// off. Only "valid" and "expired" are worth a name: at a door, "expired" is the one refusal
// staff can act on ("renew your membership"), every other reason is the association's
// business, not a stranger's.
//
// Pure (type-only import from the loader, no Prisma) so the page, and its tests, can use it
// without a database.

export type MemberCardVerifyIdentity = {
  memberName:         string
  // Already null when the association turned the category off — parseMemberCardSettings and
  // the loader handle that, this module never re-checks a setting.
  categoryName:       string | null
  associationName:    string
  // Pro-gated upstream by resolveDocumentBranding: null for an association without custom
  // branding, which then shows its name alone.
  associationLogoUrl: string | null
}

export type MemberCardVerifyDisplay =
  | { state: "valid";   validUntil: Date; identity: MemberCardVerifyIdentity }
  | { state: "expired"; expiredOn:  Date; identity: MemberCardVerifyIdentity }
  | { state: "invalid" }

// `null` covers both "no member holds this token" (unknown, or revoked — rotating a card
// replaces the token outright) and the page's own pre-database refusals: a malformed token
// and a rate-limited request come in here as the same nothing, so none of them can be told
// apart from the outside.
export function memberCardVerifyDisplay(card: MemberCardData | null): MemberCardVerifyDisplay {
  if (!card) return { state: "invalid" }

  const identity: MemberCardVerifyIdentity = {
    memberName:         `${card.membre.firstName} ${card.membre.lastName}`,
    categoryName:       card.membre.type?.name ?? null,
    associationName:    card.association.name,
    associationLogoUrl: card.association.logoUrl,
  }

  switch (card.eligibility.state) {
    case "valid":   return { state: "valid",   validUntil: card.eligibility.validUntil, identity }
    case "expired": return { state: "expired", expiredOn:  card.eligibility.expiredOn,  identity }
    // "unavailable" (awaiting payment) and every "none" reason (card disabled, member
    // inactive or deleted, membership cancelled, no membership at all) collapse to the same
    // anonymous answer — the reason itself would already be more than a stranger may know.
    default:        return { state: "invalid" }
  }
}

// Long, localized date for "valable jusqu'au …" / "expirée depuis le …". Always formatted in
// Paris time (see APP_TIME_ZONE): a cotisation covering a calendar year ends at 31 Dec
// 23:59:59.999 Paris, which a server running in UTC would otherwise print as 31 Dec at
// 22:59 — the right instant, the wrong-looking day for anyone checking a card on the 31st.
export function formatMemberCardVerifyDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { timeZone: APP_TIME_ZONE, day: "numeric", month: "long", year: "numeric" })
}

export type MemberCardCheckedAtParts = {
  // For <time dateTime>, so the machine-readable value stays unambiguous whatever the
  // locale's own ordering of day and month.
  isoTimestamp: string
  date:         string
  time:         string
}

// The two halves of the "vérifiée le {date} à {time}" line. Seconds are included on purpose:
// the page ticks this every second (see checked-at-clock.tsx), which is what makes a
// forwarded screenshot of someone else's valid card visibly stale.
export function formatMemberCardCheckedAt(checkedAt: Date, locale: string): MemberCardCheckedAtParts {
  return {
    isoTimestamp: checkedAt.toISOString(),
    date:         checkedAt.toLocaleDateString(locale, { timeZone: APP_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" }),
    time:         checkedAt.toLocaleTimeString(locale, { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  }
}
