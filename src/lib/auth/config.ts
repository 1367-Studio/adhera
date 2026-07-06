import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

const credentialsSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

// Set by signInWithGooglePortal() right before redirecting to Google — its presence tells
// the signIn callback below this is a portal (member) sign-in scoped to one association,
// as opposed to a dashboard (staff) sign-in with no association context at all.
export const OAUTH_PORTAL_SLUG_COOKIE = "oauth-portal-slug"

function generateRandomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

function splitName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/)
  return { firstName: parts[0] || "Membre", lastName: parts.slice(1).join(" ") || "" }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email:    { label: "Email",        type: "email"    },
        password: { label: "Mot de passe", type: "password" },
        slug:     { label: "Slug",         type: "text"     },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) return null

        const slug = typeof credentials?.slug === "string" && credentials.slug !== "null" ? credentials.slug.trim() || null : null

        let user: Awaited<ReturnType<typeof prisma.user.findFirst>> = null

        if (slug) {
          // Portal login: validate against the specific association — email is unique within it
          const association = await prisma.association.findUnique({
            where:  { slug },
            select: { id: true },
          })
          if (!association) return null
          const candidate = await prisma.user.findFirst({
            where: { email: parsed.data.email, associationId: association.id, deletedAt: null },
          })
          if (candidate?.active && await bcrypt.compare(parsed.data.password, candidate.passwordHash)) {
            user = candidate
          }
        } else {
          // Dashboard login: `email` is only unique *per association* (@@unique([email, associationId])),
          // so the same address can legitimately belong to unrelated accounts in different
          // associations (e.g. an admin of one association who is also a portal member of
          // another). Try each candidate's password instead of picking an arbitrary one —
          // otherwise a login attempt could silently authenticate as the wrong account.
          const candidates = await prisma.user.findMany({
            where: { email: parsed.data.email, deletedAt: null, active: true },
          })
          for (const candidate of candidates) {
            if (await bcrypt.compare(parsed.data.password, candidate.passwordHash)) {
              user = candidate
              break
            }
          }
        }

        if (!user) return null

        const association = user.associationId
          ? await prisma.association.findUnique({
              where:  { id: user.associationId },
              select: { slug: true },
            })
          : null

        return {
          id:               user.id,
          email:            user.email,
          name:             user.name,
          role:             user.role,
          associationId:    user.associationId    ?? null,
          associationSlug:  association?.slug     ?? null,
        }
      },
    }),
    Google({
      // Explicit, rather than relying on Google's default env var auto-detection
      // (AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET) — this project's .env uses the more common
      // GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET names instead.
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
    error:  "/login",
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

        let dbUser = await prisma.user.findFirst({
          where: { email, associationId: association.id, deletedAt: null },
        })

        if (!dbUser) {
          const passwordHash = await bcrypt.hash(generateRandomPassword(), 12)
          let membreId: string | null = null

          dbUser = await prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
              data: {
                email, name: `${firstName} ${lastName}`.trim() || email,
                passwordHash, role: "MEMBRE", associationId: association.id,
              },
            })

            // Link to an existing unlinked Membre by email if available, same as the
            // portal self-registration route, to avoid creating a duplicate person.
            const existingMembre = await tx.membre.findFirst({
              where: { email, associationId: association.id, userId: null, deletedAt: null },
              select: { id: true },
            })
            if (existingMembre) {
              await tx.membre.update({
                where: { id: existingMembre.id },
                data:  { userId: created.id, firstName, lastName, status: "ACTIF" },
              })
              membreId = existingMembre.id
            } else {
              const membre = await tx.membre.create({
                data: { firstName, lastName, email, associationId: association.id, userId: created.id, status: "ACTIF" },
              })
              membreId = membre.id
            }
            return created
          })

          if (membreId) {
            await writeActivityLog({
              associationId: association.id,
              action:        "MEMBRE_PORTAL_REGISTERED",
              entity:        "Membre",
              entityId:      membreId,
              label:         `${firstName} ${lastName}`.trim() || email,
              metadata:      { via: "google" },
            })
          }
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
    authorized({ auth: session, request }) {
      const isLoggedIn  = !!session?.user
      const { pathname } = request.nextUrl

      // Portal login pages — always public
      if (/^\/portal\/[^/]+\/login/.test(pathname)) return true

      const user = session?.user as { role?: string; subscriptionStatus?: string | null } | undefined
      // A cancelled subscription hard-blocks the association's dashboard/portal — but never
      // the platform's own SUPER_ADMIN accounts, which aren't tied to a single association's billing.
      const isSuspended = isLoggedIn && user?.role !== "SUPER_ADMIN" && user?.subscriptionStatus === "CANCELLED"

      // Portal protected pages — redirect to slug-specific login
      const portalMatch = pathname.match(/^\/portal\/([^/]+)/)
      if (portalMatch) {
        if (!isLoggedIn || isSuspended) {
          const slug     = portalMatch[1]
          const loginUrl = new URL(`/portal/${slug}/login`, request.url)
          if (!isLoggedIn) loginUrl.searchParams.set("callbackUrl", pathname)
          if (isSuspended) loginUrl.searchParams.set("suspended", "1")
          return Response.redirect(loginUrl)
        }
        return true
      }

      if (pathname.startsWith("/dashboard")) {
        if (!isLoggedIn) return false
        if (isSuspended) {
          const loginUrl = new URL("/login", request.url)
          loginUrl.searchParams.set("suspended", "1")
          return Response.redirect(loginUrl)
        }
        return true
      }

      if (pathname.startsWith("/backoffice")) return isLoggedIn
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id              = user.id
        token.role            = (user as { role?: string }).role
        token.associationId   = (user as { associationId?:   string | null }).associationId
        token.associationSlug = (user as { associationSlug?: string | null }).associationSlug
        token.subscriptionStatus = token.associationId
          ? (await prisma.association.findUnique({
              where:  { id: token.associationId as string },
              select: { subscriptionStatus: true },
            }))?.subscriptionStatus ?? null
          : null
      } else if (token.id) {
        const fresh = await prisma.user.findUnique({
          where:  { id: token.id as string },
          select: {
            role: true, associationId: true, active: true, deletedAt: true,
            association: { select: { subscriptionStatus: true } },
          },
        })
        if (!fresh || !fresh.active || fresh.deletedAt) {
          return null
        }
        token.role               = fresh.role
        token.associationId      = fresh.associationId
        token.subscriptionStatus = fresh.association?.subscriptionStatus ?? null
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
        }
        u.id                 = token.id                 as string
        u.role               = token.role               as string
        u.associationId      = token.associationId      as string | null | undefined
        u.associationSlug    = token.associationSlug    as string | null | undefined
        u.subscriptionStatus = token.subscriptionStatus as string | null | undefined
      }
      return session
    },
  },
})
