import { describe, expect, it } from "vitest"
import type { MemberCardEligibility } from "@/lib/member-card/eligibility"
import type { MemberCardData } from "@/lib/member-card/loader"
import { DEFAULT_MEMBER_CARD_SETTINGS } from "@/lib/member-card/settings"
import {
  formatMemberCardCheckedAt,
  formatMemberCardVerifyDate,
  memberCardVerifyDisplay,
} from "@/lib/member-card/verify-display"

// 31 Dec 2026 23:59:59.999 Paris (CET, UTC+1) — what endOfCotisationYear(2026) returns.
const END_OF_2026_PARIS = new Date("2026-12-31T22:59:59.999Z")
const END_OF_2025_PARIS = new Date("2025-12-31T22:59:59.999Z")

function buildCard(eligibility: MemberCardEligibility): MemberCardData {
  return {
    eligibility,
    settings: { ...DEFAULT_MEMBER_CARD_SETTINGS, enabled: true },
    // The loader hands these back whatever the state — the whole job of
    // memberCardVerifyDisplay is to decide when a stranger may see them.
    membre: {
      firstName: "Camille",
      lastName:  "Martin",
      photoUrl:  "https://example.test/photo.jpg",
      type:      { name: "Adhérent bénévole", color: "#023D9D" },
    },
    association: {
      name:         "Les Amis du Parc",
      logoUrl:      "https://example.test/logo.png",
      // Off by default, so the loader hands back neither — the verify screen shows the
      // association's name, never a way to contact it.
      phone:        null,
      contactEmail: null,
    },
  }
}

describe("memberCardVerifyDisplay — what a stranger may see", () => {
  it("shows the member and the association for a valid card", () => {
    const display = memberCardVerifyDisplay(
      buildCard({ state: "valid", validUntil: END_OF_2026_PARIS, cotisationId: "cotisation-2026" }),
    )
    expect(display).toEqual({
      state:      "valid",
      validUntil: END_OF_2026_PARIS,
      identity: {
        memberName:         "Camille Martin",
        categoryName:       "Adhérent bénévole",
        associationName:    "Les Amis du Parc",
        associationLogoUrl: "https://example.test/logo.png",
      },
    })
  })

  it("keeps the member visible for an expired card, so staff can ask them to renew", () => {
    const display = memberCardVerifyDisplay(buildCard({ state: "expired", expiredOn: END_OF_2025_PARIS }))
    expect(display).toMatchObject({
      state:     "expired",
      expiredOn: END_OF_2025_PARIS,
      identity:  { memberName: "Camille Martin" },
    })
  })

  // The security property this module exists for: none of these may reveal that the token
  // belongs to a real person, nor which of the reasons applies.
  it.each<[string, MemberCardEligibility]>([
    ["card disabled by the association", { state: "none", reason: "disabled" }],
    ["member inactive or deleted",       { state: "none", reason: "inactive-member" }],
    ["membership cancelled",             { state: "none", reason: "cancelled" }],
    ["no membership at all",             { state: "none", reason: "no-membership" }],
    ["awaiting payment",                 { state: "unavailable", reason: "pending", cotisationId: "cotisation-2026" }],
    ["partly paid",                      { state: "unavailable", reason: "partial", cotisationId: "cotisation-2026" }],
    ["payment overdue",                  { state: "unavailable", reason: "late",    cotisationId: "cotisation-2026" }],
  ])("%s → invalid, carrying no data whatsoever", (_label, eligibility) => {
    expect(memberCardVerifyDisplay(buildCard(eligibility))).toEqual({ state: "invalid" })
  })

  it("treats an unknown, revoked, malformed or rate-limited token (null) as the same invalid", () => {
    expect(memberCardVerifyDisplay(null)).toEqual({ state: "invalid" })
  })

  it("omits the category when the association chose not to show it", () => {
    const card = buildCard({ state: "valid", validUntil: END_OF_2026_PARIS, cotisationId: "cotisation-2026" })
    card.membre.type = null
    expect(memberCardVerifyDisplay(card)).toMatchObject({ identity: { categoryName: null } })
  })

  it("never carries the photo the loader returned", () => {
    const display = memberCardVerifyDisplay(
      buildCard({ state: "valid", validUntil: END_OF_2026_PARIS, cotisationId: "cotisation-2026" }),
    )
    expect(JSON.stringify(display)).not.toContain("photo.jpg")
  })
})

describe("member card verification dates are read in Paris time", () => {
  // 00:30 on 21 Sep Paris, still 22:30 on the 20th in UTC — a server running in UTC would
  // print the wrong day for anyone checking a card late in the evening.
  const LATE_EVENING_PARIS = new Date("2026-09-20T22:30:15Z")

  it("formats a validity date in the viewer's language", () => {
    expect(formatMemberCardVerifyDate(END_OF_2026_PARIS, "fr")).toBe("31 décembre 2026")
    expect(formatMemberCardVerifyDate(END_OF_2026_PARIS, "en")).toBe("December 31, 2026")
  })

  it("splits the checked-at instant into the date and time the {date}/{time} message expects", () => {
    const parts = formatMemberCardCheckedAt(LATE_EVENING_PARIS, "fr")
    expect(parts).toMatchObject({ isoTimestamp: "2026-09-20T22:30:15.000Z", date: "21/09/2026" })
    // Seconds included: the page re-renders this every second so a screenshot goes stale.
    expect(parts.time).toContain("00:30:15")
  })
})
