import { describe, expect, it } from "vitest"
import {
  DEFAULT_MEMBER_CARD_COLOR,
  contrastRatio,
  getContrastingTextColor,
  isColorTooLightOnWhite,
  relativeLuminance,
  resolveMemberCardColor,
} from "@/lib/member-card/color"

describe("relativeLuminance", () => {
  it.each<[string, number]>([
    ["#000000", 0],
    ["#ffffff", 1],
    // Reference values from the WCAG 2.1 definition, to 4 decimals.
    ["#ff0000", 0.2126],
    ["#00ff00", 0.7152],
    ["#0000ff", 0.0722],
  ])("%s → %d", (hexColor, expected) => {
    expect(relativeLuminance(hexColor)).toBeCloseTo(expected, 4)
  })

  it("is case-insensitive and tolerates surrounding spaces", () => {
    expect(relativeLuminance("  #FF0000 ")).toBeCloseTo(relativeLuminance("#ff0000"), 10)
  })

  // A hand-edited settings row must degrade, not throw: black is the safe reading (white
  // text stays legible on it, and it never raises a false "too light" warning).
  it.each(["", "#fff", "red", "#1a2b3cff", "#gggggg", "1a2b3c"])("treats %o as black", (raw) => {
    expect(relativeLuminance(raw)).toBe(0)
  })
})

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for a colour against itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 4)
    expect(contrastRatio("#023D9D", "#023D9D")).toBeCloseTo(1, 10)
  })

  it("does not depend on the order of its arguments", () => {
    expect(contrastRatio("#023D9D", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#023D9D"), 10)
  })
})

describe("getContrastingTextColor", () => {
  it.each<[string, string]>([
    ["#023D9D", "#ffffff"], // the default deep blue → white text
    ["#000000", "#ffffff"],
    ["#ffffff", "#000000"],
    ["#ffff00", "#000000"], // yellow is far brighter than it looks
    ["#f5c518", "#000000"],
    ["#7f1d1d", "#ffffff"],
  ])("%s carries %s text", (backgroundColor, expectedTextColor) => {
    expect(getContrastingTextColor(backgroundColor)).toBe(expectedTextColor)
  })

  it("always returns the better of the two, never a mid-tone", () => {
    for (const backgroundColor of ["#023D9D", "#ffff00", "#808080", "#ffffff"]) {
      const textColor = getContrastingTextColor(backgroundColor)
      expect(contrastRatio(backgroundColor, textColor))
        .toBeGreaterThanOrEqual(contrastRatio(backgroundColor, textColor === "#ffffff" ? "#000000" : "#ffffff"))
    }
  })
})

describe("isColorTooLightOnWhite", () => {
  it.each(["#ffffff", "#fefefe", "#f5f5f5", "#e5e5e5", "#ffff00", "#fff7cc"])("%s is too light", (hexColor) => {
    expect(isColorTooLightOnWhite(hexColor)).toBe(true)
  })

  it.each(["#023D9D", "#000000", "#cccccc", "#16a34a", "#dc2626", "#808080"])("%s is usable", (hexColor) => {
    expect(isColorTooLightOnWhite(hexColor)).toBe(false)
  })

  // Same reasoning as relativeLuminance: a broken value must not pop a warning the admin
  // can do nothing about — the renderer falls back to the default colour anyway.
  it("never flags an unparseable colour", () => {
    expect(isColorTooLightOnWhite("not-a-colour")).toBe(false)
  })
})

describe("resolveMemberCardColor", () => {
  it("falls back to the platform default when the association never picked one", () => {
    expect(resolveMemberCardColor(null)).toBe(DEFAULT_MEMBER_CARD_COLOR)
  })

  it("keeps the association's own colour", () => {
    expect(resolveMemberCardColor("#16a34a")).toBe("#16a34a")
  })

  it("ships a default that is neither too light nor low-contrast for its own text", () => {
    expect(isColorTooLightOnWhite(DEFAULT_MEMBER_CARD_COLOR)).toBe(false)
    expect(contrastRatio(DEFAULT_MEMBER_CARD_COLOR, getContrastingTextColor(DEFAULT_MEMBER_CARD_COLOR)))
      .toBeGreaterThanOrEqual(4.5)
  })
})
