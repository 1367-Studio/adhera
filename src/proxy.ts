import { auth } from "@/lib/auth/config"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { BASE_PATH } from "@/lib/env"

export async function proxy(request: NextRequest) {
  const session    = await auth()
  const { pathname } = request.nextUrl
  const isLoggedIn = !!session?.user

  const user = session?.user as { role?: string; subscriptionStatus?: string | null } | undefined
  const isNotSuperAdmin = isLoggedIn && user?.role !== "SUPER_ADMIN"
  // CANCELLED (subscription actually ended) and SUSPENDED (repeated failed renewal) are
  // both standby states, not a hard block: the portal (members have no billing action
  // available) is locked out the same for both, but the dashboard lets the association's
  // own admin through to the standby screen below — never the platform's own SUPER_ADMIN
  // accounts, which aren't tied to a single association's billing.
  const isLocked = isNotSuperAdmin && (user?.subscriptionStatus === "CANCELLED" || user?.subscriptionStatus === "SUSPENDED")

  // `don` is the standalone public donation page: a stranger with no account must be able
  // to hit the URL, pay, and receive the reçu fiscal by email (POST /api/public/[slug]/don
  // is unauthenticated and IP-rate-limited for exactly that). Anchored with (\/|$) so `don`
  // does NOT also open up `/portal/[slug]/dons`, the members-only donation history.
  const isPortalPublic   = /^\/portal\/[^/]+\/(login|register|don)(\/|$)/.test(pathname)
  const portalMatch      = pathname.match(/^\/portal\/([^/]+)/)
  const isDashboard      = pathname.startsWith("/dashboard")
  const isBackoffice     = pathname.startsWith("/backoffice")
  const isAdminLogin     = pathname === "/login"
  const standbyPath      = "/dashboard/abonnement-suspendu"
  // The reactivation checkout page is reached FROM the standby screen and must stay
  // accessible to a locked-out admin the same way the standby screen itself does —
  // otherwise clicking "Se réabonner" just bounces straight back here.
  const isStandbyPage    = pathname === standbyPath || pathname === "/dashboard/reactiver-abonnement"

  // Portal public pages (login, register) — always accessible
  if (isPortalPublic) return NextResponse.next()

  // Portal protected routes — ALWAYS redirect to slug-specific login, never /login
  if (portalMatch) {
    if (!isLoggedIn || isLocked) {
      const slug     = portalMatch[1]
      const loginUrl = new URL(`${BASE_PATH}/portal/${slug}/login`, request.url)
      if (!isLoggedIn) loginUrl.searchParams.set("callbackUrl", pathname)
      if (isLocked) loginUrl.searchParams.set("suspended", "1")
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  // Dashboard — redirect to admin login
  if (isDashboard) {
    if (!isLoggedIn) {
      const loginUrl = new URL(`${BASE_PATH}/login`, request.url)
      loginUrl.searchParams.set("callbackUrl", pathname)
      return NextResponse.redirect(loginUrl)
    }
    // Locked admins (suspended or cancelled) stay logged in, but every dashboard page
    // except the standby screen itself redirects there until they reactivate.
    if (isLocked && !isStandbyPage) {
      return NextResponse.redirect(new URL(`${BASE_PATH}${standbyPath}`, request.url))
    }
  }

  // Backoffice — same deep-link-preserving redirect as the dashboard, so a signed-out
  // SUPER_ADMIN clicking a ticket notification email link lands back on that ticket
  // after logging in instead of on the backoffice root.
  if (isBackoffice && !isLoggedIn) {
    const loginUrl = new URL(`${BASE_PATH}/login`, request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Already logged in on admin login page → go to dashboard
  if (isAdminLogin && isLoggedIn) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/dashboard`, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
