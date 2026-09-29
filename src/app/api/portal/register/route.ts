import { NextResponse } from "next/server"

// Self-registration is disabled portal-wide (see PortalLoginForm and
// portal/[slug]/register/page.tsx, which no longer expose or serve this flow) — rejected
// here too, not just hidden in the UI, so a bookmarked/shared URL or a direct call can't
// bypass it and create an unbilled account. Unrelated to the adhesion-form checkout routes
// (/api/public/[slug]/adhesion/[formSlug]/checkout, /api/membership-forms/*), which stay on.
// The prior implementation (user/membre creation, default cotisation, welcome email) is in
// git history if self-registration is ever reintroduced.
export async function POST() {
  return NextResponse.json(
    { error: "L'inscription en ligne n'est plus disponible. Contactez un administrateur de votre association." },
    { status: 403 },
  )
}
