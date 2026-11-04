import { beforeEach, describe, expect, it, vi } from "vitest"

// The route is exercised end-to-end through mcp-handler with the DB and Stripe mocked out,
// so this also proves the zod-4 input schemas are accepted by the MCP SDK v2.
const prismaMock = vi.hoisted(() => ({
  association: {
    count:   vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    groupBy: vi.fn(async () => []),
  },
  membre:        { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
  supportTicket: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
  activityLog:   { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
}))

vi.mock("@/lib/prisma/client", () => ({ prisma: prismaMock }))
vi.mock("@/lib/stripe", () => ({
  getPricingInfo:           vi.fn(async () => { throw new Error("stripe unavailable in tests") }),
  customerHasPaymentMethod: vi.fn(async () => false),
}))
vi.mock("@/lib/pricing-offers", () => ({
  validateOfferPhases: (phases: unknown) => Array.isArray(phases),
}))

const TEST_TOKEN = "route-test-token-abcdefghijklmnop"

async function callMcp(body: unknown, authorizationHeader: string | null = `Bearer ${TEST_TOKEN}`) {
  const { POST } = await import("@/app/api/mcp/mcp/route")
  const headers = new Headers({
    "content-type":         "application/json",
    accept:                 "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  })
  if (authorizationHeader) headers.set("authorization", authorizationHeader)
  return POST(new Request("https://app.formwise.fr/app/api/mcp/mcp", { method: "POST", headers, body: JSON.stringify(body) }))
}

// Streamable HTTP may answer as JSON or as a single SSE "data:" event — accept both.
async function readJsonRpc(response: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const rawBody = await response.text()
  const dataLine = rawBody.split("\n").find(line => line.startsWith("data:"))
  return JSON.parse(dataLine ? dataLine.slice("data:".length) : rawBody)
}

describe("admin MCP route", () => {
  beforeEach(() => {
    vi.stubEnv("FORMWISE_ADMIN_MCP_TOKEN", TEST_TOKEN)
  })

  it("rejects requests without the bearer token", async () => {
    const response = await callMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null)
    expect(response.status).toBe(401)
  })

  it("is disabled (503) when the env var is missing", async () => {
    vi.stubEnv("FORMWISE_ADMIN_MCP_TOKEN", "")
    const response = await callMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    expect(response.status).toBe(503)
  })

  it("lists exactly the read-only tools", async () => {
    const response = await callMcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    expect(response.status).toBe(200)
    const message = await readJsonRpc(response)
    const tools = (message.result?.tools ?? []) as { name: string; annotations?: { readOnlyHint?: boolean } }[]
    expect(tools.map(tool => tool.name).sort()).toEqual([
      "get_association",
      "get_overview",
      "list_recent_activity",
      "list_signups",
      "list_support_tickets",
      "list_trials",
      "search_associations",
    ])
    expect(tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true)
  })

  it("runs get_overview against the (mocked) DB and returns JSON text", async () => {
    const response = await callMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_overview", arguments: {} } })
    const message = await readJsonRpc(response)
    const content = message.result?.content as { type: string; text: string }[]
    const overview = JSON.parse(content[0].text)
    expect(overview.totalAssociations).toBe(0)
    expect(overview.mrr.mrrEuros).toBe(0)
    expect(overview.mrr.catalogPricesAvailable).toBe(false)
  })

  it("applies the default limit of 25 on list tools", async () => {
    await callMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_signups", arguments: {} } })
    const findManyCalls = prismaMock.association.findMany.mock.calls as unknown as [{ take?: number }][]
    expect(findManyCalls.at(-1)?.[0].take).toBe(25)
  })
})
