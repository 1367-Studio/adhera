// Type-only import, deliberately: loader.ts pulls in Prisma, and this module is imported from
// client components (member-card.tsx, member-card-settings.tsx). `import type` is erased at
// build time, so the shape crosses over but the database client never does — same arrangement
// as verify-display.ts.
import type { MemberCardData } from "@/lib/member-card/loader"
import type { MemberCardSettings } from "@/lib/member-card/settings"

/**
 * Everything the card renderer is allowed to know — deliberately *not* a Prisma row.
 *
 * The card is shown in three places that each authenticate differently (the member's portal,
 * a manager's modal, a public scan page), so the decisions about what a given viewer may see
 * belong to the caller, upstream: loadMemberCardEligibility() already drops the photo and the
 * category when the association turned them off, and the caller resolves the state from
 * getMemberCardEligibility(). By the time a view model exists, nothing is left to decide and
 * nothing private can leak through a field the renderer forgot to check.
 *
 * Every phase that renders a card builds one of these:
 *   phase 3 (portal) · phase 4 (manager modal) · phase 5 (public scan) · phase 6 (PDF).
 */
export type MemberCardViewModel = {
  associationName: string
  /** null on a plan without custom branding (resolveDocumentBranding) — the card then shows no logo at all, never the platform's own. */
  logoUrl:         string | null
  /** Already assembled for display ("Camille Martin"), so the renderer never decides name order. */
  memberName:      string
  /** Membre type name, or null when hidden by settings.showCategory / the member has none. */
  category:        string | null
  validUntil:      Date
  /**
   * Only the two states a card can actually be *printed* in. "unavailable" and "none" have no
   * card to show (the caller shows the explanatory screen instead), so they are unrepresentable
   * here rather than something the renderer has to handle.
   */
  state:           "valid" | "expired"
  photoUrl:        string | null
  /** Shown in place of a missing photo — built by buildMemberCardInitials below. */
  initials:        string
  /**
   * Absolute URL the QR encodes. Passed in rather than derived: the public verification URL
   * depends on the member's rotatable card token and on the deployment's base path, neither of
   * which a presentational component should know about.
   */
  verificationUrl: string
  settings:        MemberCardSettings
}

/**
 * Initials for the photo fallback. Takes the two name parts separately (that is how they are
 * stored) and tolerates either being empty — an association that only recorded a single name
 * still gets one readable letter rather than a blank circle.
 */
export function buildMemberCardInitials(firstName: string, lastName: string): string {
  const firstInitial = firstName.trim().charAt(0)
  const lastInitial  = lastName.trim().charAt(0)
  return `${firstInitial}${lastInitial}`.toUpperCase()
}

/**
 * The one mapping from what loadMemberCardEligibility() read to what a renderer may show, so
 * the surfaces that print a card (portal, manager modal, public scan, PDF) cannot drift on
 * name order, on which date an expired card shows, or on when there is no card at all.
 *
 * Takes the loader's return type as-is, `null` included: a membreId that matches nobody in
 * this association is just as much "no card" as an ineligible member, and collapsing both
 * here saves every caller a second branch.
 *
 * Returns null for "unavailable" and for every "none" reason. Those states have no card to
 * print — MemberCardViewModel.state makes them unrepresentable on purpose — and the screen
 * shown instead differs per surface (the member's portal names the reason and links to the
 * payment; a public scan must reveal nothing), so that choice stays with the caller.
 *
 * Nothing is re-decided here: the loader already dropped the photo and the category when the
 * association turned them off, and resolved the logo through resolveDocumentBranding. This
 * function only renames and assembles.
 */
export function buildMemberCardViewModel(
  loaded: MemberCardData | null,
  verificationUrl: string,
): MemberCardViewModel | null {
  if (!loaded) return null

  const { eligibility, membre, association, settings } = loaded
  if (eligibility.state !== "valid" && eligibility.state !== "expired") return null

  return {
    associationName: association.name,
    logoUrl:         association.logoUrl,
    // "Camille Martin" — the order membre-detail-view.tsx and memberCardVerifyDisplay use.
    // (The members *table* sorts by "Martin Camille"; a card is not a sorted list.)
    memberName:      `${membre.firstName} ${membre.lastName}`,
    category:        membre.type?.name ?? null,
    // An expired card has no validUntil of its own: the day it stopped covering *is* its
    // expiry date, and the renderer prints a single date either way, labelled by `state`.
    validUntil:      eligibility.state === "valid" ? eligibility.validUntil : eligibility.expiredOn,
    state:           eligibility.state,
    photoUrl:        membre.photoUrl,
    initials:        buildMemberCardInitials(membre.firstName, membre.lastName),
    verificationUrl,
    settings,
  }
}
