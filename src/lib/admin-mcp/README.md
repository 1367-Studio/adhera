# Formwise admin MCP (read-only)

An internal [MCP](https://modelcontextprotocol.io) server that lets the founder query
platform-wide Formwise data from Claude, e.g. "new sign-ups this week?",
"which associations are on trial and when do trials end?", "MRR?",
"open support tickets?" or "tell me about association X".

- **URL:** `https://app.formwise.fr/app/api/mcp/mcp` (Streamable HTTP, stateless, no SSE)
- **Header:** `Authorization: Bearer <FORMWISE_ADMIN_MCP_TOKEN>`
- **Code:** `src/app/api/mcp/mcp/route.ts`, `src/lib/admin-mcp/` (this file)

## Setup

1. Generate a secret (`openssl rand -hex 32`) and set it as `FORMWISE_ADMIN_MCP_TOKEN`
   in the Vercel project's env vars (Production), then redeploy.
   If it's unset, the endpoint answers `503` and does nothing at all.
   A missing or wrong token gets `401`.
2. Connect Claude:
   - **Claude Code:**
     ```bash
     claude mcp add --transport http formwise-admin https://app.formwise.fr/app/api/mcp/mcp \
       --header "Authorization: Bearer $FORMWISE_ADMIN_MCP_TOKEN"
     ```
   - **Claude.ai / Claude Desktop:** Settings → Connectors → *Add custom connector*, with the
     URL above. This needs the client to send the `Authorization` header. If your client only
     supports OAuth connectors, use Claude Code or `mcp-remote` with `--header` instead.

To rotate the token, change the env var and redeploy; the old token stops working immediately.

## Tools

| Tool | What it returns |
| --- | --- |
| `get_overview` | Associations by subscription status and by plan, new associations (7/30 days), trials ending in the next 7 days, MRR/ARR estimate, total members, open support tickets |
| `list_signups {sinceDays=30, limit}` | Associations created in the window, newest first, with plan, status, trial end, signup admin name/email and member count |
| `list_trials {endingWithinDays?, limit, checkPaymentMethod=true}` | Associations in TRIAL, soonest end first, with days left, admin email and whether a card is on file (read-only Stripe check, first 25 rows) |
| `search_associations {query, limit}` | Case-insensitive match on name, slug, city or admin email |
| `get_association {idOrSlug}` | Billing/plan fields, pricing offer, site, modules, staff accounts, counts (members by status, events, cotisations and amount collected, paid dons, tickets), last activity |
| `list_support_tickets {status?, limit}` | Tickets across all associations without message bodies: subject, status, association, last message date and side, unread flag |
| `list_recent_activity {action?, sinceDays=7, limit}` | ActivityLog rows across associations (never `metadata`), plus counts per action |

List tools return 25 rows by default and at most 100. Amounts are in euros and dates are ISO 8601 (UTC).

### MRR definition

No MRR existed elsewhere in the app. The backoffice revenue chart shows Stripe *net cash*,
including Connect commissions, which is a different number. MRR here is the sum of
`subscriptionAmountCents` over ACTIVE associations with an amount above 0. That's the same
"paying" rule as `platformFeeRate()`. Each amount is normalized to a monthly value:

- a matching PricingOffer phase is spread over its `months`;
- a catalog yearly price is divided by 12;
- otherwise, a current period ending more than 45 days out is treated as yearly;
- everything else counts as monthly.

PAST_DUE associations are reported separately as "at risk".

## Read-only guarantee and data exposure

- The tools only call Prisma `findMany`/`findFirst`/`count`/`groupBy`/`aggregate`. They
  never write to the DB.
- They make only read-only Stripe calls, the same ones the backoffice already makes:
  `prices.retrieve` through `getPricingInfo`, and `customers.retrieve`/`subscriptions.retrieve`
  through `customerHasPaymentMethod`.
- No email/SMS/Pusher module is imported.
- The endpoint is cross-tenant by design. Member personal data only ever leaves as **counts**.
  Password hashes, tokens, 2FA secrets, API keys, IBANs, Stripe ids and ActivityLog
  metadata are never selected.
- `src/proxy.ts` (next-auth) doesn't run on `/api/*` because its matcher excludes `api`, so the
  route is never redirected to the login page. Authentication is the bearer token only.
