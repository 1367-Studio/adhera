import { describe, expect, it, vi } from "vitest"
import { checkAdminMcpToken, extractBearerToken, withAdminMcpToken } from "@/lib/admin-mcp/auth"

const EXPECTED_TOKEN = "s3cret-token-for-tests-0123456789"

describe("extractBearerToken", () => {
  it("reads the token after the Bearer scheme, case-insensitively", () => {
    expect(extractBearerToken(`Bearer ${EXPECTED_TOKEN}`)).toBe(EXPECTED_TOKEN)
    expect(extractBearerToken(`bearer   ${EXPECTED_TOKEN}  `)).toBe(EXPECTED_TOKEN)
  })

  it("rejects missing headers and other schemes", () => {
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken("")).toBeNull()
    expect(extractBearerToken("Bearer ")).toBeNull()
    expect(extractBearerToken(`Basic ${EXPECTED_TOKEN}`)).toBeNull()
  })
})

describe("checkAdminMcpToken", () => {
  it("accepts the exact token", () => {
    expect(checkAdminMcpToken(`Bearer ${EXPECTED_TOKEN}`, EXPECTED_TOKEN)).toBe("ok")
  })

  it("rejects a wrong token of the same length", () => {
    const sameLengthWrongToken = EXPECTED_TOKEN.slice(0, -1) + "X"
    expect(sameLengthWrongToken).toHaveLength(EXPECTED_TOKEN.length)
    expect(checkAdminMcpToken(`Bearer ${sameLengthWrongToken}`, EXPECTED_TOKEN)).toBe("unauthorized")
  })

  it("rejects tokens of a different length without throwing", () => {
    expect(checkAdminMcpToken("Bearer short", EXPECTED_TOKEN)).toBe("unauthorized")
    expect(checkAdminMcpToken(`Bearer ${EXPECTED_TOKEN}-and-more`, EXPECTED_TOKEN)).toBe("unauthorized")
  })

  it("rejects a missing header", () => {
    expect(checkAdminMcpToken(null, EXPECTED_TOKEN)).toBe("unauthorized")
    expect(checkAdminMcpToken(undefined, EXPECTED_TOKEN)).toBe("unauthorized")
  })

  it("reports unconfigured when the env var is unset or blank, whatever is sent", () => {
    expect(checkAdminMcpToken(`Bearer ${EXPECTED_TOKEN}`, undefined)).toBe("unconfigured")
    expect(checkAdminMcpToken("Bearer ", "")).toBe("unconfigured")
    expect(checkAdminMcpToken(`Bearer ${EXPECTED_TOKEN}`, "   ")).toBe("unconfigured")
  })
})

describe("withAdminMcpToken", () => {
  function buildRequest(authorizationHeader?: string): Request {
    const headers = new Headers({ "content-type": "application/json" })
    if (authorizationHeader) headers.set("authorization", authorizationHeader)
    return new Request("https://app.formwise.fr/app/api/mcp/mcp", { method: "POST", headers, body: "{}" })
  }

  it("returns 503 and never calls the MCP handler when the secret is not configured", async () => {
    const innerHandler = vi.fn(async () => new Response("inner"))
    const guardedHandler = withAdminMcpToken(innerHandler, () => undefined)
    const response = await guardedHandler(buildRequest(`Bearer ${EXPECTED_TOKEN}`))
    expect(response.status).toBe(503)
    expect(innerHandler).not.toHaveBeenCalled()
  })

  it("returns 401 with a Bearer challenge on a wrong or missing token", async () => {
    const innerHandler = vi.fn(async () => new Response("inner"))
    const guardedHandler = withAdminMcpToken(innerHandler, () => EXPECTED_TOKEN)

    const wrongTokenResponse = await guardedHandler(buildRequest("Bearer nope"))
    expect(wrongTokenResponse.status).toBe(401)
    expect(wrongTokenResponse.headers.get("WWW-Authenticate")).toMatch(/^Bearer/)

    const missingTokenResponse = await guardedHandler(buildRequest())
    expect(missingTokenResponse.status).toBe(401)
    expect(innerHandler).not.toHaveBeenCalled()
  })

  it("delegates to the MCP handler on a valid token", async () => {
    const innerHandler = vi.fn(async () => new Response("inner", { status: 200 }))
    const guardedHandler = withAdminMcpToken(innerHandler, () => EXPECTED_TOKEN)
    const response = await guardedHandler(buildRequest(`Bearer ${EXPECTED_TOKEN}`))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("inner")
    expect(innerHandler).toHaveBeenCalledTimes(1)
  })
})
