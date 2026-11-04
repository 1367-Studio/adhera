import { createMcpHandler } from "mcp-handler"
import { withAdminMcpToken } from "@/lib/admin-mcp/auth"
import { registerAdminTools } from "@/lib/admin-mcp/tools"

// Founder-only, READ-ONLY MCP server (Streamable HTTP, stateless — no SSE, no Redis).
// Public URL: https://app.formwise.fr/app/api/mcp/mcp (basePath "/app" from next.config.ts).
// Auth: `Authorization: Bearer $FORMWISE_ADMIN_MCP_TOKEN` (see src/lib/admin-mcp/auth.ts);
// unset env → 503. src/proxy.ts never runs for /api/* (its matcher excludes "api"), so
// next-auth doesn't redirect this route to the login page. Docs: src/lib/admin-mcp/README.md.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Overview/trials fan out a dozen DB queries + a few read-only Stripe lookups; 30s is ample.
export const maxDuration = 30

const mcpHandler = createMcpHandler(
  server => registerAdminTools(server),
  {
    serverInfo:   { name: "formwise-admin", version: "1.0.0" },
    instructions: "Read-only founder dashboard for Formwise (SaaS for French associations). All amounts are EUR, dates ISO 8601 (UTC). Cross-tenant: covers every association. Member personal data is only ever returned as counts.",
  },
)

const handler = withAdminMcpToken(mcpHandler)

export { handler as GET, handler as POST, handler as DELETE }
