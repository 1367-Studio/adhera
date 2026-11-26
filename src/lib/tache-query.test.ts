import { describe, expect, it } from "vitest"
import { parseTacheFilters, buildTacheWhere } from "@/lib/tache-query"

describe("parseTacheFilters", () => {
  it("parses every known field, trimming search", () => {
    const params = new URLSearchParams({
      membreId: "m1", categorieId: "c1", status: "EN_COURS",
      dueBefore: "2026-12-01", dueAfter: "2026-11-01", search: "  relancer  ",
    })
    expect(parseTacheFilters(params)).toEqual({
      membreId: "m1", categorieId: "c1", status: "EN_COURS",
      dueBefore: "2026-12-01", dueAfter: "2026-11-01", search: "relancer",
    })
  })

  it("rejects an unknown status value instead of passing it through", () => {
    const params = new URLSearchParams({ status: "BOGUS" })
    expect(parseTacheFilters(params).status).toBeUndefined()
  })

  it("returns all-undefined filters for an empty query", () => {
    expect(parseTacheFilters(new URLSearchParams())).toEqual({
      membreId: undefined, categorieId: undefined, status: undefined,
      dueBefore: undefined, dueAfter: undefined, search: undefined,
    })
  })
})

describe("buildTacheWhere", () => {
  it("EN_RETARD becomes a derived not-TERMINEE + past-dueDate condition, not a literal status", () => {
    const where = buildTacheWhere("assoc1", { status: "EN_RETARD" })
    expect(where.status).toEqual({ not: "TERMINEE" })
    expect(where.dueDate).toHaveProperty("lt")
  })

  it("a plain status passes through unchanged", () => {
    const where = buildTacheWhere("assoc1", { status: "TERMINEE" })
    expect(where.status).toBe("TERMINEE")
  })

  it("membreId filters via the assignees relation, not a direct column", () => {
    const where = buildTacheWhere("assoc1", { membreId: "m1" })
    expect(where.assignees).toEqual({ some: { membreId: "m1" } })
  })

  it("dueAfter and dueBefore combine into one range on the same field", () => {
    const where = buildTacheWhere("assoc1", { dueAfter: "2026-11-01", dueBefore: "2026-11-30" })
    expect(where.dueDate).toEqual({ gte: new Date("2026-11-01"), lte: new Date("2026-11-30") })
  })

  it("always scopes to the given association", () => {
    expect(buildTacheWhere("assoc1", {}).associationId).toBe("assoc1")
  })

  it("search filters the title case-insensitively", () => {
    expect(buildTacheWhere("assoc1", { search: "badges" }).titre).toEqual({ contains: "badges", mode: "insensitive" })
  })
})
