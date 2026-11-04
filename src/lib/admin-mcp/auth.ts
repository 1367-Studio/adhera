import { createHash, timingSafeEqual } from "node:crypto"

// Shared-secret gate for the founder-only admin MCP endpoint (src/app/api/mcp/mcp/route.ts).
// Deliberately NOT next-auth: the MCP client (Claude) sends a static
// `Authorization: Bearer <token>` header, there is no browser session involved.

export const ADMIN_MCP_TOKEN_ENV = "FORMWISE_ADMIN_MCP_TOKEN"

export type AdminMcpTokenCheck = "ok" | "unauthorized" | "unconfigured"

const BEARER_PREFIX = /^Bearer\s+(.+)$/i

export function extractBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null
  const prefixMatch = BEARER_PREFIX.exec(authorizationHeader.trim())
  const bearerToken = prefixMatch?.[1]?.trim()
  return bearerToken ? bearerToken : null
}

// timingSafeEqual throws on buffers of different lengths, and comparing lengths first would
// leak the secret's length through timing. Hashing both sides to a fixed 32-byte digest
// makes the comparison constant-time regardless of what the caller sent.
function constantTimeEquals(providedSecret: string, expectedSecret: string): boolean {
  const providedDigest = createHash("sha256").update(providedSecret, "utf8").digest()
  const expectedDigest = createHash("sha256").update(expectedSecret, "utf8").digest()
  return timingSafeEqual(providedDigest, expectedDigest)
}

export function checkAdminMcpToken(
  authorizationHeader: string | null | undefined,
  expectedToken: string | undefined,
): AdminMcpTokenCheck {
  // An unset or blank env var must disable the endpoint entirely, never "accept anything".
  if (!expectedToken || expectedToken.trim().length === 0) return "unconfigured"
  const providedToken = extractBearerToken(authorizationHeader)
  if (!providedToken) return "unauthorized"
  return constantTimeEquals(providedToken, expectedToken.trim()) ? "ok" : "unauthorized"
}

type RequestHandler = (request: Request) => Promise<Response>

// Wraps the MCP handler: 503 when the secret isn't configured (endpoint does nothing at all),
// 401 with a Bearer challenge when the token is missing or wrong. The MCP handler itself is
// only ever invoked for "ok".
export function withAdminMcpToken(
  handler: RequestHandler,
  readExpectedToken: () => string | undefined = () => process.env[ADMIN_MCP_TOKEN_ENV],
): RequestHandler {
  return async (request: Request) => {
    const tokenCheck = checkAdminMcpToken(request.headers.get("authorization"), readExpectedToken())
    if (tokenCheck === "unconfigured") {
      return Response.json(
        { error: "Admin MCP endpoint is not configured" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      )
    }
    if (tokenCheck === "unauthorized") {
      return Response.json(
        { error: "Unauthorized" },
        {
          status:  401,
          headers: {
            "WWW-Authenticate": 'Bearer realm="formwise-admin-mcp"',
            "Cache-Control":    "no-store",
          },
        },
      )
    }
    return handler(request)
  }
}
