import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"

const credentialsSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

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
  ],
  pages: {
    signIn: "/login",
    error:  "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
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
