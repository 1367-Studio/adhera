import { serve } from "inngest/next"
import { inngest } from "@/lib/inngest"
import { functions } from "@/inngest/functions"

// This app is mounted under Next's `basePath: "/app"` (next.config.ts), so the route
// handler's real URL is /app/api/inngest, not /api/inngest — Inngest's callback URLs
// (used for step execution) need to be told about that prefix explicitly.
export const { GET, POST, PUT } = serve({ client: inngest, functions, servePath: "/app/api/inngest" })
