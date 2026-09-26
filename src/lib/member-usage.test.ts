import { describe, expect, it } from "vitest"
import { memberUsageLevel, memberUsagePercent } from "@/lib/member-usage"

describe("memberUsageLevel", () => {
  // Product owner's reference: Starter / 30 members — orange from 25, red from 28.
  it("follows the 30-member thresholds", () => {
    expect(memberUsageLevel(24, 30)).toBe("normal")
    expect(memberUsageLevel(25, 30)).toBe("warning")
    expect(memberUsageLevel(27, 30)).toBe("warning")
    expect(memberUsageLevel(28, 30)).toBe("critical")
    expect(memberUsageLevel(30, 30)).toBe("critical")
  })

  // Same ratios on a larger plan — exact boundaries, no floating-point drift.
  it("scales the same ratios to a 150-member limit", () => {
    expect(memberUsageLevel(124, 150)).toBe("normal")
    expect(memberUsageLevel(125, 150)).toBe("warning")
    expect(memberUsageLevel(140, 150)).toBe("critical")
  })

  it("treats counts above the limit as critical", () => {
    expect(memberUsageLevel(35, 30)).toBe("critical")
  })

  // A 0 limit blocks every new member (assertMemberLimit: activeCount + 1 > 0), so it is
  // critical — and must not divide by zero.
  it("handles a zero limit safely", () => {
    expect(memberUsageLevel(0, 0)).toBe("critical")
    expect(memberUsageLevel(3, 0)).toBe("critical")
  })

  it("is normal with no active members", () => {
    expect(memberUsageLevel(0, 30)).toBe("normal")
  })
})

describe("memberUsagePercent", () => {
  it("returns the filled share of the bar", () => {
    expect(memberUsagePercent(15, 30)).toBe(50)
    expect(memberUsagePercent(0, 30)).toBe(0)
  })

  it("clamps above the limit and on a zero limit", () => {
    expect(memberUsagePercent(35, 30)).toBe(100)
    expect(memberUsagePercent(0, 0)).toBe(100)
  })
})
