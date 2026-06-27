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

        let user: Awaited<ReturnType<typeof prisma.user.findFirst>>

        if (slug) {
          // Portal login: validate against the specific association
          const association = await prisma.association.findUnique({
            where:  { slug },
            select: { id: true },
          })
          if (!association) return null
          user = await prisma.user.findFirst({
            where: { email: parsed.data.email, associationId: association.id, deletedAt: null },
          })
        } else {
          // Dashboard login: global email lookup (admin/officer accounts)
          user = await prisma.user.findFirst({
            where: { email: parsed.data.email, deletedAt: null },
          })
        }

        if (!user || !user.active) return null

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
        if (!valid) return null

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

      // Portal protected pages — redirect to slug-specific login
      const portalMatch = pathname.match(/^\/portal\/([^/]+)/)
      if (portalMatch) {
        if (!isLoggedIn) {
          const slug     = portalMatch[1]
          const loginUrl = new URL(`/portal/${slug}/login`, request.url)
          loginUrl.searchParams.set("callbackUrl", pathname)
          return Response.redirect(loginUrl)
        }
        return true
      }

      if (pathname.startsWith("/dashboard") || pathname.startsWith("/backoffice")) return isLoggedIn
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id              = user.id
        token.role            = (user as { role?: string }).role
        token.associationId   = (user as { associationId?:   string | null }).associationId
        token.associationSlug = (user as { associationSlug?: string | null }).associationSlug
      } else if (token.id) {
        const fresh = await prisma.user.findUnique({
          where:  { id: token.id as string },
          select: { role: true, associationId: true, active: true },
        })
        if (!fresh || !fresh.active) {
          return null
        }
        token.role          = fresh.role
        token.associationId = fresh.associationId
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        const u = session.user as {
          id?:              string
          role?:            string
          associationId?:   string | null
          associationSlug?: string | null
        }
        u.id              = token.id              as string
        u.role            = token.role            as string
        u.associationId   = token.associationId   as string | null | undefined
        u.associationSlug = token.associationSlug as string | null | undefined
      }
      return session
    },
  },
})
