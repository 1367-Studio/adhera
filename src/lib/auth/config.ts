import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma/client"
import { BASE_PATH } from "@/lib/env"
import { NEXT_LOCALE_COOKIE } from "@/i18n/locales"
import { getVerifiedLogin, clearVerifiedLogin } from "@/lib/auth/two-factor-store"

const credentialsSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

// Resolves an email/password pair (optionally scoped to a portal association by slug) to a
// User row, without building a session — shared by authorize() below and by authenticate()
// in actions.ts, which needs to know the *user* (specifically twoFactorEnabled) before
// deciding whether to call signIn() at all or branch into the 2FA challenge step first.
export async function resolveCredentialsUser(email: string, password: string, slug: string | null) {
  if (slug) {
    // Portal login: validate against the specific association — email is unique within it
    const association = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
    if (!association) return null
    const candidate = await prisma.user.findFirst({
      where: { email, associationId: association.id, deletedAt: null },
    })
    if (candidate?.active && await bcrypt.compare(password, candidate.passwordHash)) {
      return candidate
    }
    return null
  }

  // Dashboard login: `email` is only unique *per association* (@@unique([email, associationId])),
  // so the same address can legitimately belong to unrelated accounts in different
  // associations (e.g. an admin of one association who is also a portal member of
  // another). Test every candidate's password rather than stopping at the first
  // match — if the same password happens to be valid for more than one of them
  // (e.g. an admin reused their password across two associations), picking either
  // one silently would risk logging into the wrong account without any explanation
  // (e.g. a cancelled one instead of the active one they meant). Require exactly one
  // match, same ambiguity guard as the Google callback's candidates.length > 1 below.
  const candidates = await prisma.user.findMany({ where: { email, deletedAt: null, active: true } })
  const matches: typeof candidates = []
  for (const candidate of candidates) {
    if (await bcrypt.compare(password, candidate.passwordHash)) matches.push(candidate)
  }
  return matches.length === 1 ? matches[0] : null
}

type CredentialsUser = Awaited<ReturnType<typeof resolveCredentialsUser>>

async function buildSessionUser(user: NonNullable<CredentialsUser>) {
  const association = user.associationId
    ? await prisma.association.findUnique({ where: { id: user.associationId }, select: { slug: true } })
    : null

  return {
    id:               user.id,
    email:            user.email,
    name:             user.name,
    role:             user.role,
    associationId:    user.associationId    ?? null,
    associationSlug:  association?.slug     ?? null,
  }
}

// Set by signInWithGooglePortal() right before redirecting to Google — its presence tells
// the signIn callback below this is a portal (member) sign-in scoped to one association,
// as opposed to a dashboard (staff) sign-in with no association context at all.
export const OAUTH_PORTAL_SLUG_COOKIE = "oauth-portal-slug"

function splitName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/)
  return { firstName: parts[0] || "Membre", lastName: parts.slice(1).join(" ") || "" }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email:          { label: "Email",        type: "email" },
        password:       { label: "Mot de passe", type: "password" },
        slug:           { label: "Slug",         type: "text" },
        // Set only by verifyTwoFactorLogin() (src/lib/auth/two-factor.ts) once the second
        // factor has been checked — never submitted directly by a login form.
        twoFactorToken: { label: "2FA token",    type: "text" },
      },
      authorize: async (credentials) => {
        // Path A: completing a login whose identity is already fully established — the
        // token is the sole proof needed here. It only ever exists because either (a)
        // authenticate() (src/lib/auth/actions.ts) just checked the password and the
        // account has no 2FA to satisfy, or (b) verifyTwoFactorLogin()
        // (src/lib/auth/two-factor.ts) checked the password earlier *and* just checked the
        // second factor. Either way this is the one place both flows converge to actually
        // sign in, avoiding a second bcrypt.compare of the same password on every login.
        //
        // Deliberately a distinct Redis namespace ("verified", see two-factor-store.ts)
        // from the "pending" record a 2FA-enabled login sits in while still awaiting its
        // code — a still-pending token must never reach here directly, or the code check
        // would be skippable. get-then-delete makes this single-use, same reasoning as
        // PasswordResetToken elsewhere in this file.
        if (typeof credentials?.twoFactorToken === "string" && credentials.twoFactorToken) {
          const verified = await getVerifiedLogin(credentials.twoFactorToken)
          if (!verified) return null
          await clearVerifiedLogin(credentials.twoFactorToken)

          const user = await prisma.user.findUnique({
            where: { id: verified.userId, deletedAt: null },
          })
          if (!user || !user.active) return null

          return buildSessionUser(user)
        }

        // Path B: normal email + password.
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) return null

        const slug = typeof credentials?.slug === "string" && credentials.slug !== "null" ? credentials.slug.trim() || null : null

        const user = await resolveCredentialsUser(parsed.data.email, parsed.data.password, slug)
        if (!user) return null

        // 2FA enabled — login must go through Path A (pendingToken) instead, so the client
        // gets a chance to challenge the second factor. authenticate() already checks this
        // before ever calling signIn(), so in practice this only guards against some other
        // caller invoking signIn() directly and skipping that check.
        if (user.twoFactorEnabled) return null

        return buildSessionUser(user)
      },
    }),
    Google({
      // Explicit, rather than relying on Google's default env var auto-detection
      // (AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET) — this project's .env uses the more common
      // GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET names instead.
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Without this, Google silently signs in with the browser's sole active session
      // instead of showing the account chooser.
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  pages: {
    signIn: `${BASE_PATH}/login`,
    error:  `${BASE_PATH}/login`,
  },
  session: { strategy: "jwt" },
  callbacks: {
    // Google has no notion of our associations/roles, so this callback resolves (or, for
    // the portal, creates) the matching internal User/Membre and stamps the extra fields
    // the jwt callback below already expects from the Credentials provider's authorize().
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true

      const email = (profile?.email ?? user.email ?? "").toLowerCase()
      if (!email) return false

      const cookieStore = await cookies()
      const slug = cookieStore.get(OAUTH_PORTAL_SLUG_COOKIE)?.value ?? null
      if (slug) cookieStore.delete(OAUTH_PORTAL_SLUG_COOKIE)

      const { firstName, lastName } = splitName(profile?.name ?? user.name)
      const u = user as typeof user & { role?: string; associationId?: string | null; associationSlug?: string | null }

      if (slug) {
        // Portal (member) sign-in — the association is known from the URL the button was
        // clicked on, carried across the Google redirect via a short-lived cookie.
        const association = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
        if (!association) return `/portal/${slug}/login?error=association`

        const dbUser = await prisma.user.findFirst({
          where: { email, associationId: association.id, deletedAt: null },
        })

        // Never auto-create here, same reasoning as the dashboard branch below: creating an
        // account is also the moment consent to the privacy policy is captured (see
        // PortalRegisterForm/src/app/api/portal/register/route.ts), which needs an actual
        // form + checkbox, not a silent callback. Route to that form instead, prefilled;
        // nothing is written to the database until it's submitted.
        if (!dbUser) {
          const params = new URLSearchParams({ g_name: `${firstName} ${lastName}`.trim(), g_email: email })
          return `/portal/${slug}/register?${params.toString()}`
        }

        if (!dbUser.active) return `/portal/${slug}/login?error=inactive`

        u.id              = dbUser.id
        u.email           = dbUser.email
        u.name            = dbUser.name
        u.role            = dbUser.role
        u.associationId   = dbUser.associationId
        u.associationSlug = slug
        return true
      }

      // Dashboard (staff) sign-in — no association context at all. Never auto-create here:
      // that would let anyone with a Google account self-promote into some association's
      // admin. Instead route to the existing paid-signup wizard with the name/email
      // prefilled; nothing is written to the database unless that flow completes.
      const candidates = await prisma.user.findMany({ where: { email, deletedAt: null, active: true } })

      if (candidates.length === 0) {
        const params = new URLSearchParams({ g_name: `${firstName} ${lastName}`.trim(), g_email: email })
        return `/register?${params.toString()}`
      }
      // Email is unique per-association, not globally — the same address can legitimately
      // belong to unrelated accounts in different associations. Google only proves email
      // ownership, not which of several accounts to open, so fall back to password login.
      if (candidates.length > 1) return "/login?error=multi"

      const dbUser = candidates[0]

      // Google only proves email ownership, not the second factor — signing in this way
      // would otherwise skip the Credentials provider's authorize() entirely (see
      // resolveCredentialsUser/twoFactorToken above) and with it any 2FA check, silently
      // defeating a staff member's 2FA the moment they click "Continuer avec Google"
      // instead of typing their password. Route to the password form instead, which does
      // enforce it.
      if (dbUser.twoFactorEnabled) return "/login?error=2fa_required"

      const association = dbUser.associationId
        ? await prisma.association.findUnique({ where: { id: dbUser.associationId }, select: { slug: true } })
        : null

      u.id              = dbUser.id
      u.email           = dbUser.email
      u.name            = dbUser.name
      u.role            = dbUser.role
      u.associationId   = dbUser.associationId
      u.associationSlug = association?.slug ?? null
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id              = user.id
        token.role            = (user as { role?: string }).role
        token.associationId   = (user as { associationId?:   string | null }).associationId
        token.associationSlug = (user as { associationSlug?: string | null }).associationSlug
        // Only ever set here, in the branch that only runs on an actual sign-in — every
        // other request re-enters the `else` branch below and leaves this untouched, so it
        // stays stable across refreshes/token rotation for the lifetime of one login.
        // Lets "show once per login" features (e.g. FiscalPeriodPopup) tell a genuine
        // relogin apart from the user just reloading the page.
        token.loginAt = Date.now()
        token.subscriptionStatus = token.associationId
          ? (await prisma.association.findUnique({
              where:  { id: token.associationId as string },
              select: { subscriptionStatus: true },
            }))?.subscriptionStatus ?? null
          : null
        const freshUser = await prisma.user.findUnique({
          where:  { id: user.id },
          select: { locale: true, twoFactorEnabled: true },
        })
        token.locale           = freshUser?.locale ?? "fr"
        token.twoFactorEnabled = freshUser?.twoFactorEnabled ?? false

        // Sync the user's saved preference to the device on every fresh sign-in, so switching
        // devices/browsers shows their chosen language immediately instead of that device's
        // previous NEXT_LOCALE cookie (or lack thereof) until they open the switcher again.
        const cookieStore = await cookies()
        cookieStore.set(NEXT_LOCALE_COOKIE, token.locale as string, {
          secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/",
        })
      } else if (token.id) {
        const fresh = await prisma.user.findUnique({
          where:  { id: token.id as string },
          select: {
            role: true, associationId: true, active: true, deletedAt: true, locale: true,
            twoFactorEnabled: true,
            association: { select: { subscriptionStatus: true } },
          },
        })
        if (!fresh || !fresh.active || fresh.deletedAt) {
          return null
        }
        token.role               = fresh.role
        token.associationId      = fresh.associationId
        token.subscriptionStatus = fresh.association?.subscriptionStatus ?? null
        token.locale             = fresh.locale
        token.twoFactorEnabled   = fresh.twoFactorEnabled
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        const u = session.user as {
          id?:                 string
          role?:               string
          associationId?:      string | null
          associationSlug?:    string | null
          subscriptionStatus?: string | null
          locale?:             string
          loginAt?:            number
          twoFactorEnabled?:   boolean
        }
        u.id                 = token.id                 as string
        u.role               = token.role               as string
        u.associationId      = token.associationId      as string | null | undefined
        u.associationSlug    = token.associationSlug    as string | null | undefined
        u.subscriptionStatus = token.subscriptionStatus as string | null | undefined
        u.locale             = token.locale              as string | undefined
        u.loginAt            = token.loginAt             as number | undefined
        u.twoFactorEnabled   = token.twoFactorEnabled    as boolean | undefined
      }
      return session
    },
  },
})
