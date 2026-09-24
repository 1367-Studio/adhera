import { describe, expect, it } from "vitest"
import { DEFAULT_MEMBER_CARD_SETTINGS, parseMemberCardSettings } from "@/lib/member-card/settings"

describe("parseMemberCardSettings", () => {
  it.each([null, undefined, "enabled", 42, ["classic"]])("%o → defaults (card disabled)", (raw) => {
    expect(parseMemberCardSettings(raw)).toEqual(DEFAULT_MEMBER_CARD_SETTINGS)
    expect(parseMemberCardSettings(raw).enabled).toBe(false)
  })

  it("keeps valid stored values", () => {
    const stored = {
      enabled: true, template: "modern", color: "#1A2b3C",
      showPhoto: false, showCategory: false, showTier: false, showPhone: true, showEmail: true,
    }
    expect(parseMemberCardSettings(stored)).toEqual(stored)
  })

  // The contact details are the one pair that must never appear by accident: an association
  // stores a phone number for its invoices long before it decides to print it on every card.
  it("keeps the association's contact details off unless they were stored as on", () => {
    expect(DEFAULT_MEMBER_CARD_SETTINGS.showPhone).toBe(false)
    expect(DEFAULT_MEMBER_CARD_SETTINGS.showEmail).toBe(false)

    // A row written before these settings existed: the two keys are simply absent.
    const storedBeforeTheFeature = { enabled: true, template: "modern", color: null, showPhoto: true, showCategory: true }
    expect(parseMemberCardSettings(storedBeforeTheFeature)).toMatchObject({ showPhone: false, showEmail: false })

    expect(parseMemberCardSettings({ ...storedBeforeTheFeature, showPhone: "oui", showEmail: 1 }))
      .toMatchObject({ showPhone: false, showEmail: false })
  })

  it("falls back field by field, never touching the valid ones", () => {
    const stored = { enabled: true, template: "retro", color: "blue", showPhoto: "yes" }
    expect(parseMemberCardSettings(stored)).toEqual({ ...DEFAULT_MEMBER_CARD_SETTINGS, enabled: true })
  })

  it.each(["#fff", "1a2b3c", "#1a2b3cff", "#gggggg"])("rejects colour %s", (color) => {
    expect(parseMemberCardSettings({ enabled: true, color }).color).toBeNull()
  })

  it("drops unknown keys", () => {
    expect(parseMemberCardSettings({ enabled: true, secondaryColor: "#000000" })).not.toHaveProperty("secondaryColor")
  })
})
