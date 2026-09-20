import { describe, expect, it } from "vitest"
import { DEFAULT_MEMBER_CARD_SETTINGS, parseMemberCardSettings } from "@/lib/member-card/settings"

describe("parseMemberCardSettings", () => {
  it.each([null, undefined, "enabled", 42, ["classic"]])("%o → defaults (card disabled)", (raw) => {
    expect(parseMemberCardSettings(raw)).toEqual(DEFAULT_MEMBER_CARD_SETTINGS)
    expect(parseMemberCardSettings(raw).enabled).toBe(false)
  })

  it("keeps valid stored values", () => {
    const stored = { enabled: true, template: "modern", color: "#1A2b3C", showPhoto: false, showCategory: false }
    expect(parseMemberCardSettings(stored)).toEqual(stored)
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
