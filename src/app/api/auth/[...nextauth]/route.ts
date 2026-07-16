import { NextRequest } from "next/server"
import { handlers } from "@/lib/auth/config"
import { BASE_PATH } from "@/lib/env"

// Next.js's own `basePath` (next.config.ts) strips "/app" from the URL before a Route
// Handler ever sees it — but Auth.js derives the mount point it expects incoming requests
// to match ("/app/api/auth") from NEXTAUTH_URL's path, which needs that "/app" so the
// *outgoing* redirect_uri sent to Google matches what's registered in Google Cloud Console
// (see the comment on APP_URL in lib/env.ts). Those two disagree on whether "/app" is
// present, so Auth.js's own action/provider parser throws UnknownAction
// ("Cannot parse action at /api/auth/callback/google") on literally every request unless
// the prefix is put back here first — verified live against the "developer" Vercel preview.
function withBasePath(req: NextRequest): NextRequest {
  const url = new URL(req.url)
  if (url.pathname.startsWith(BASE_PATH)) return req
  url.pathname = `${BASE_PATH}${url.pathname}`
  return new NextRequest(url, req)
}

export const GET  = (req: NextRequest) => handlers.GET(withBasePath(req))
export const POST = (req: NextRequest) => handlers.POST(withBasePath(req))
