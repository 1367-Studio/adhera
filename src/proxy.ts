import { auth } from "@/lib/auth/config"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const session    = await auth()
  const { pathname } = request.nextUrl
  const isLoggedIn = !!session?.user

  const user = session?.user as { role?: string; subscriptionStatus?: string | null } | undefined
  // A cancelled subscription hard-blocks the association's dashboard/portal — but never
  // the platform's own SUPER_ADMIN accounts, which aren't tied to a single association's billing.
  const isSuspended = isLoggedIn && user?.role !== "SUPER_ADMIN" && user?.subscriptionStatus === "CANCELLED"

  const isPortalPublic   = /^\/portal\/[^/]+\/(login|register)/.test(pathname)
  const portalMatch      = pathname.match(/^\/portal\/([^/]+)/)
  const isDashboard      = pathname.startsWith("/dashboard")
  const isAdminLogin     = pathname === "/login"

  // Portal public pages (login, register) — always accessible
  if (isPortalPublic) return NextResponse.next()

  // Portal protected routes — ALWAYS redirect to slug-specific login, never /login
  if (portalMatch) {
    if (!isLoggedIn || isSuspended) {
      const slug     = portalMatch[1]
      const loginUrl = new URL(`/portal/${slug}/login`, request.url)
      if (!isLoggedIn) loginUrl.searchParams.set("callbackUrl", pathname)
      if (isSuspended) loginUrl.searchParams.set("suspended", "1")
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  // Dashboard — redirect to admin login
  if (isDashboard) {
    if (!isLoggedIn) return NextResponse.redirect(new URL("/login", request.url))
    if (isSuspended) {
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("suspended", "1")
      return NextResponse.redirect(loginUrl)
    }
  }

  // Already logged in on admin login page → go to dashboard
  if (isAdminLogin && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
