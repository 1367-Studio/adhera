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
  /** MembershipTier label behind the printed cotisation, or null when it wasn't created via a MembershipForm. Never gated by settings.showCategory — a tarifa is not a category. */
  tier:            string | null
  /** Only set when `state` is "valid" — an expired card prints a single date, not a range. */
  validFrom:       Date | null
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
   * The association's contact details as one finished line ("01 23 45 67 89 · contact@…"), or
   * null when there is nothing to show — the settings are off, or the association never filled
   * the fields in. Already joined by formatMemberCardContact so the screen card and the PDF
   * cannot drift on the separator or on the order.
   */
  contactLine:     string | null
  /**
   * The same two values contactLine joins, kept separately so the screen card can put a phone
   * glyph in front of the number without re-parsing the finished line. Both already null under
   * the same rules as contactLine (setting off, or never filled in).
   */
  contactPhone:    string | null
  contactEmail:    string | null
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
 * The association's phone and contact e-mail as the single line a card prints, phone first.
 *
 * The separator is a middle dot rather than a slash or a pipe: it reads as a pause instead of
 * as a boundary, and it survives the PDF's sanitizeForWinAnsi untouched (U+00B7 is WinAnsi
 * 0xB7). Either half may be absent — the settings are per-field and an association may have
 * filled in only one — and the result then carries no dangling separator; both absent returns
 * null, which is what tells each renderer to draw nothing at all rather than an empty line.
 *
 * Shared on purpose: the screen card and the PDF both render this string as-is, so neither can
 * invent its own order or its own separator.
 */
export function formatMemberCardContact(phone: string | null, email: string | null): string | null {
  const contactParts = [phone, email]
    .map(contactValue => contactValue?.trim() ?? "")
    .filter(contactValue => contactValue.length > 0)
  return contactParts.length > 0 ? contactParts.join(" · ") : null
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
    tier:            membre.tier,
    validFrom:       eligibility.state === "valid" ? eligibility.validFrom : null,
    // An expired card has no validUntil of its own: the day it stopped covering *is* its
    // expiry date, and the renderer prints a single date either way, labelled by `state`.
    validUntil:      eligibility.state === "valid" ? eligibility.validUntil : eligibility.expiredOn,
    state:           eligibility.state,
    photoUrl:        membre.photoUrl,
    initials:        buildMemberCardInitials(membre.firstName, membre.lastName),
    // Both halves already arrive null when the association turned the setting off or left the
    // field blank (the loader does that), so this only joins.
    contactLine:     formatMemberCardContact(association.phone, association.contactEmail),
    contactPhone:    association.phone,
    contactEmail:    association.contactEmail,
    verificationUrl,
    settings,
  }
}
