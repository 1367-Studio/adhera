import { describe, expect, it } from "vitest"
import type { MemberCardEligibility } from "@/lib/member-card/eligibility"
import type { MemberCardData } from "@/lib/member-card/loader"
import { DEFAULT_MEMBER_CARD_SETTINGS } from "@/lib/member-card/settings"
import {
  buildMemberCardInitials,
  buildMemberCardViewModel,
  formatMemberCardContact,
} from "@/lib/member-card/view-model"

// 31 Dec 23:59:59.999 Paris (CET, UTC+1) — what endOfCotisationYear() returns for each year.
const END_OF_2026_PARIS = new Date("2026-12-31T22:59:59.999Z")
const END_OF_2025_PARIS = new Date("2025-12-31T22:59:59.999Z")
// 1 Jan 2026 00:00:00 Paris (CET, UTC+1) — what startOfCotisationYear() returns for 2026.
const START_OF_2026_PARIS = new Date("2025-12-31T23:00:00.000Z")

const VERIFICATION_URL = "http://localhost:3000/app/carte/Hn2pQ8vLmK4sT7wXyZ0aBc"

// Shaped like loadMemberCardEligibility()'s return value: the photo and the category arrive
// already null when the association turned them off, so the tests below switch them off the
// same way the loader would rather than by flipping a setting this module never reads.
function buildLoadedCard(eligibility: MemberCardEligibility): MemberCardData {
  return {
    eligibility,
    settings: { ...DEFAULT_MEMBER_CARD_SETTINGS, enabled: true },
    membre: {
      firstName: "Camille",
      lastName:  "Martin",
      photoUrl:  "https://example.test/photo.jpg",
      type:      { name: "Adhérent bénévole", color: "#023D9D" },
    },
    association: {
      name:    "Les Amis du Parc",
      logoUrl: "https://example.test/logo.png",
      // Same arrangement as the photo above: the loader already returns null when the setting
      // is off or the field was never filled in, so the tests switch the contact line off the
      // way the loader would rather than by flipping a setting this module never reads.
      phone:        "01 23 45 67 89",
      contactEmail: "contact@amis-du-parc.fr",
    },
  }
}

const VALID_ELIGIBILITY: MemberCardEligibility = {
  state:        "valid",
  validFrom:    START_OF_2026_PARIS,
  validUntil:   END_OF_2026_PARIS,
  cotisationId: "cotisation-2026",
}

describe("buildMemberCardViewModel", () => {
  it("maps a valid card to everything the renderer needs, and nothing else", () => {
    const viewModel = buildMemberCardViewModel(buildLoadedCard(VALID_ELIGIBILITY), VERIFICATION_URL)
    expect(viewModel).toEqual({
      associationName: "Les Amis du Parc",
      logoUrl:         "https://example.test/logo.png",
      memberName:      "Camille Martin",
      category:        "Adhérent bénévole",
      validFrom:       START_OF_2026_PARIS,
      validUntil:      END_OF_2026_PARIS,
      state:           "valid",
      photoUrl:        "https://example.test/photo.jpg",
      initials:        "CM",
      contactLine:     "01 23 45 67 89 · contact@amis-du-parc.fr",
      contactPhone:    "01 23 45 67 89",
      contactEmail:    "contact@amis-du-parc.fr",
      verificationUrl: VERIFICATION_URL,
      settings:        { ...DEFAULT_MEMBER_CARD_SETTINGS, enabled: true },
    })
  })

  // An expired card is still printed — the renderer labels it from `state` — so the date it
  // stopped covering has to land in the single date field the view model carries.
  it("uses the expiry date as validUntil for an expired card", () => {
    const viewModel = buildMemberCardViewModel(
      buildLoadedCard({ state: "expired", expiredOn: END_OF_2025_PARIS }),
      VERIFICATION_URL,
    )
    expect(viewModel).toMatchObject({
      state:      "expired",
      validUntil: END_OF_2025_PARIS,
      memberName: "Camille Martin",
    })
  })

  // The states that have no card at all: the caller shows its own explanatory screen, so the
  // renderer must never be handed a view model it would print as a real card.
  it.each<[string, MemberCardEligibility]>([
    ["card disabled by the association", { state: "none", reason: "disabled" }],
    ["member inactive or deleted",       { state: "none", reason: "inactive-member" }],
    ["membership cancelled",             { state: "none", reason: "cancelled" }],
    ["no membership at all",             { state: "none", reason: "no-membership" }],
    ["awaiting payment",                 { state: "unavailable", reason: "pending", cotisationId: "cotisation-2026" }],
    ["partly paid",                      { state: "unavailable", reason: "partial", cotisationId: "cotisation-2026" }],
    ["payment overdue",                  { state: "unavailable", reason: "late",    cotisationId: "cotisation-2026" }],
  ])("%s → null, there is no card to render", (_label, eligibility) => {
    expect(buildMemberCardViewModel(buildLoadedCard(eligibility), VERIFICATION_URL)).toBeNull()
  })

  it("treats an unknown member (the loader's null) as the same absence of a card", () => {
    expect(buildMemberCardViewModel(null, VERIFICATION_URL)).toBeNull()
  })

  it("carries no photo when the association hid it (the loader already nulled it)", () => {
    const loadedCard = buildLoadedCard(VALID_ELIGIBILITY)
    loadedCard.membre.photoUrl = null
    loadedCard.settings = { ...loadedCard.settings, showPhoto: false }

    const viewModel = buildMemberCardViewModel(loadedCard, VERIFICATION_URL)
    expect(viewModel).toMatchObject({ photoUrl: null })
    // The fallback stays filled, so a card without a photo still shows initials, not a blank.
    expect(viewModel?.initials).toBe("CM")
  })

  it("carries no category when the association hid it, or when the member has no type", () => {
    const hiddenByTheSetting = buildLoadedCard(VALID_ELIGIBILITY)
    hiddenByTheSetting.membre.type = null
    hiddenByTheSetting.settings = { ...hiddenByTheSetting.settings, showCategory: false }
    expect(buildMemberCardViewModel(hiddenByTheSetting, VERIFICATION_URL)).toMatchObject({ category: null })

    // Same null, other cause: the setting is on but this member was never given a type.
    const memberWithoutAType = buildLoadedCard(VALID_ELIGIBILITY)
    memberWithoutAType.membre.type = null
    expect(buildMemberCardViewModel(memberWithoutAType, VERIFICATION_URL)).toMatchObject({ category: null })
  })

  // Pro-gated upstream by resolveDocumentBranding: an association without custom branding
  // shows its name alone, never the platform's own logo.
  it("keeps a null logo null rather than substituting a default", () => {
    const loadedCard = buildLoadedCard(VALID_ELIGIBILITY)
    loadedCard.association.logoUrl = null
    expect(buildMemberCardViewModel(loadedCard, VERIFICATION_URL)).toMatchObject({ logoUrl: null })
  })

  // The contact line is per-field: the loader nulls the half whose setting is off, and the
  // view model has to carry the other one alone rather than a line with a dangling separator.
  it("carries only the contact details the loader kept", () => {
    const phoneOnly = buildLoadedCard(VALID_ELIGIBILITY)
    phoneOnly.association.contactEmail = null
    expect(buildMemberCardViewModel(phoneOnly, VERIFICATION_URL))
      .toMatchObject({ contactLine: "01 23 45 67 89" })

    const emailOnly = buildLoadedCard(VALID_ELIGIBILITY)
    emailOnly.association.phone = null
    expect(buildMemberCardViewModel(emailOnly, VERIFICATION_URL))
      .toMatchObject({ contactLine: "contact@amis-du-parc.fr" })
  })

  // Both settings off — the common case, since both default to false — must leave nothing for
  // the renderers to draw, not an empty line holding space above the validity.
  it("carries no contact line when the association kept both details off", () => {
    const withoutContact = buildLoadedCard(VALID_ELIGIBILITY)
    withoutContact.association.phone        = null
    withoutContact.association.contactEmail = null
    withoutContact.settings = { ...withoutContact.settings, showPhone: false, showEmail: false }
    expect(buildMemberCardViewModel(withoutContact, VERIFICATION_URL))
      .toMatchObject({ contactLine: null })
  })

  it("passes the verification URL through untouched, since the QR must match it exactly", () => {
    const viewModel = buildMemberCardViewModel(buildLoadedCard(VALID_ELIGIBILITY), VERIFICATION_URL)
    expect(viewModel?.verificationUrl).toBe(VERIFICATION_URL)
  })
})

describe("formatMemberCardContact", () => {
  it("puts the phone first and joins with a middle dot", () => {
    expect(formatMemberCardContact("01 23 45 67 89", "contact@amis-du-parc.fr"))
      .toBe("01 23 45 67 89 · contact@amis-du-parc.fr")
  })

  // One setting on and the other off is an ordinary configuration, and so is an association
  // that only ever filled in one of the two fields: neither may leave a separator hanging.
  it("returns the one detail it has, with no separator", () => {
    expect(formatMemberCardContact("01 23 45 67 89", null)).toBe("01 23 45 67 89")
    expect(formatMemberCardContact(null, "contact@amis-du-parc.fr")).toBe("contact@amis-du-parc.fr")
  })

  // null, not "": that is what tells both renderers to draw nothing at all, rather than an
  // empty line taking up the space above the validity.
  it("returns null when there is nothing to show", () => {
    expect(formatMemberCardContact(null, null)).toBeNull()
  })

  it("treats a blank field as no field, whitespace included", () => {
    expect(formatMemberCardContact("", "")).toBeNull()
    expect(formatMemberCardContact("   ", "\t")).toBeNull()
    expect(formatMemberCardContact("  ", "contact@amis-du-parc.fr")).toBe("contact@amis-du-parc.fr")
  })

  it("trims the values rather than printing the spaces around them", () => {
    expect(formatMemberCardContact("  01 23 45 67 89 ", " contact@amis-du-parc.fr "))
      .toBe("01 23 45 67 89 · contact@amis-du-parc.fr")
  })
})

describe("buildMemberCardInitials", () => {
  it("takes one letter from each name, upper-cased", () => {
    expect(buildMemberCardInitials("Camille", "Martin")).toBe("CM")
    expect(buildMemberCardInitials("camille", "martin")).toBe("CM")
  })

  // An association that only recorded one of the two names still gets a readable letter
  // instead of an empty circle.
  it("survives a missing or blank half", () => {
    expect(buildMemberCardInitials("Camille", "")).toBe("C")
    expect(buildMemberCardInitials("", "Martin")).toBe("M")
    expect(buildMemberCardInitials("  ", "  ")).toBe("")
  })

  it("ignores surrounding whitespace rather than turning it into an initial", () => {
    expect(buildMemberCardInitials("  Camille ", " Martin ")).toBe("CM")
  })

  it("keeps accented initials, which French member names routinely start with", () => {
    expect(buildMemberCardInitials("Élodie", "Ávila")).toBe("ÉÁ")
  })
})
