"use server"

import { randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { AuthError } from "next-auth"
import { auth, signIn } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { BASE_PATH } from "@/lib/env"
import { rateLimit } from "@/lib/rate-limit"
import { writeActivityLog } from "@/lib/activity-log"
import { generateTotpSecret, generateTotpUri, verifyTotpCode } from "@/lib/auth/totp"
import {
  setPendingSetup, getPendingSetup, clearPendingSetup,
  getPendingLogin, clearPendingLogin, setVerifiedLogin,
  type PendingLogin,
} from "@/lib/auth/two-factor-store"

type SessionUser = { id?: string; role?: string; associationId?: string | null }
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

async function requireStaffSession(): Promise<{ id: string; role: string; associationId: string | null } | null> {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.id || !u.role || u.role === "MEMBRE") return null
  return { id: u.id, role: u.role, associationId: u.associationId ?? null }
}

function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-")
  )
}

// entityId defaults to actorId — every caller except adminDisableTwoFactor acts on their
// own account, so actor and entity are the same person there. adminDisableTwoFactor is the
// one case where they differ (SUPER_ADMIN acting on someone else's account) and passes the
// target's id explicitly — passing entityId is required there, not optional, so the two
// can't be silently conflated again.
async function logTwoFactorEvent(
  associationId: string | null, actorId: string, action: string, label?: string | null, entityId: string = actorId,
) {
  if (!associationId) return
  await writeActivityLog({ associationId, actorId, action, entity: "User", entityId, label })
}

// ── Step 1: generate secret and return QR URI ─────────────────────────────────────

export async function initTotpSetup(): Promise<Result<{ totpUri: string }>> {
  const session = await requireStaffSession()
  if (!session) return { ok: false, error: "Non authentifié." }

  const user = await prisma.user.findUnique({
    where:  { id: session.id },
    select: { email: true, twoFactorEnabled: true },
  })
  if (!user) return { ok: false, error: "Utilisateur introuvable." }
  if (user.twoFactorEnabled) return { ok: false, error: "L'authentification à deux facteurs est déjà activée." }

  const secret = generateTotpSecret()
  await setPendingSetup(session.id, secret)

  return { ok: true, totpUri: generateTotpUri(user.email, secret) }
}

// ── Step 2: confirm a TOTP code → enable 2FA + generate backup codes ──────────────

export async function confirmTotpSetup(code: string): Promise<Result<{ backupCodes: string[] }>> {
  const session = await requireStaffSession()
  if (!session) return { ok: false, error: "Non authentifié." }

  const allowed = await rateLimit(`2fa-setup:${session.id}`, 8, 15 * 60 * 1000)
  if (!allowed) return { ok: false, error: "Trop de tentatives. Réessayez plus tard." }

  const secret = await getPendingSetup(session.id)
  if (!secret) return { ok: false, error: "Session de configuration expirée. Veuillez recommencer." }

  if (!verifyTotpCode(code, secret)) return { ok: false, error: "Code invalide. Vérifiez votre application." }

  const plainCodes = generateBackupCodes()
  const hashedCodes = await Promise.all(plainCodes.map((c) => bcrypt.hash(c, 12)))

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: session.id },
      data:  { twoFactorEnabled: true, twoFactorSecret: secret },
      select: { id: true, name: true, email: true },
    })
    await tx.twoFactorBackupCode.deleteMany({ where: { userId: session.id } })
    await tx.twoFactorBackupCode.createMany({
      data: hashedCodes.map((codeHash) => ({ userId: session.id, codeHash })),
    })
    return updated
  })

  await clearPendingSetup(session.id)
  await logTwoFactorEvent(session.associationId, session.id, "TWO_FACTOR_ENABLED", user.name ?? user.email)

  return { ok: true, backupCodes: plainCodes }
}

// ── Current status (for the settings modal) ────────────────────────────────────────

export async function getTwoFactorStatus(): Promise<Result<{ enabled: boolean; backupCodesRemaining: number }>> {
  const session = await requireStaffSession()
  if (!session) return { ok: false, error: "Non authentifié." }

  const user = await prisma.user.findUnique({
    where:  { id: session.id },
    select: { twoFactorEnabled: true, twoFactorBackupCodes: { where: { usedAt: null }, select: { id: true } } },
  })
  if (!user) return { ok: false, error: "Utilisateur introuvable." }

  return { ok: true, enabled: user.twoFactorEnabled, backupCodesRemaining: user.twoFactorBackupCodes.length }
}

// ── Disable 2FA (requires password confirmation) ───────────────────────────────────

export async function disableTwoFactor(password: string): Promise<Result> {
  const session = await requireStaffSession()
  if (!session) return { ok: false, error: "Non authentifié." }

  const allowed = await rateLimit(`2fa-disable:${session.id}`, 5, 15 * 60 * 1000)
  if (!allowed) return { ok: false, error: "Trop de tentatives. Réessayez plus tard." }

  const user = await prisma.user.findUnique({
    where:  { id: session.id },
    select: { passwordHash: true, twoFactorEnabled: true, name: true, email: true },
  })
  if (!user) return { ok: false, error: "Utilisateur introuvable." }
  if (!user.twoFactorEnabled) return { ok: false, error: "L'authentification à deux facteurs n'est pas activée." }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash)
  if (!passwordMatch) return { ok: false, error: "Mot de passe incorrect." }

  await prisma.$transaction([
    prisma.user.update({ where: { id: session.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } }),
    prisma.twoFactorBackupCode.deleteMany({ where: { userId: session.id } }),
  ])

  await logTwoFactorEvent(session.associationId, session.id, "TWO_FACTOR_DISABLED", user.name ?? user.email)
  return { ok: true }
}

// ── Support recovery: SUPER_ADMIN disables 2FA on someone else's behalf ────────────
//
// Self-service has no other way out of losing both the authenticator and every backup
// code — for a small association where the admin acting is the association's only staff
// account, that's a full lockout otherwise. No password confirmation here (unlike
// disableTwoFactor above): SUPER_ADMIN is platform staff acting on a support request, not
// the account owner, so there's no password of theirs to check.

export async function adminDisableTwoFactor(userId: string): Promise<Result> {
  const session = await auth()
  const admin = session?.user as SessionUser | undefined
  if (admin?.role !== "SUPER_ADMIN") return { ok: false, error: "Non autorisé." }

  const user = await prisma.user.findUnique({
    where:  { id: userId, deletedAt: null },
    select: { associationId: true, twoFactorEnabled: true, name: true, email: true },
  })
  if (!user) return { ok: false, error: "Utilisateur introuvable." }
  if (!user.twoFactorEnabled) return { ok: false, error: "L'authentification à deux facteurs n'est pas activée." }

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } }),
    prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
  ])

  // Logged under the target's association (not the superadmin's — they typically have
  // none), actor is the superadmin, entity is the target account (must be passed
  // explicitly — see logTwoFactorEvent's doc comment for why this differs from every other
  // call site here), label makes clear this bypassed the account owner.
  await logTwoFactorEvent(
    user.associationId, admin.id!, "TWO_FACTOR_DISABLED_BY_ADMIN",
    `${user.name ?? user.email} (par le support)`, userId,
  )
  return { ok: true }
}

// ── Regenerate backup codes (requires TOTP confirmation) ───────────────────────────

export async function regenerateBackupCodes(code: string): Promise<Result<{ backupCodes: string[] }>> {
  const session = await requireStaffSession()
  if (!session) return { ok: false, error: "Non authentifié." }

  const allowed = await rateLimit(`2fa-regen:${session.id}`, 8, 15 * 60 * 1000)
  if (!allowed) return { ok: false, error: "Trop de tentatives. Réessayez plus tard." }

  const user = await prisma.user.findUnique({
    where:  { id: session.id },
    select: { twoFactorEnabled: true, twoFactorSecret: true, name: true, email: true },
  })
  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    return { ok: false, error: "L'authentification à deux facteurs n'est pas activée." }
  }
  if (!verifyTotpCode(code, user.twoFactorSecret)) return { ok: false, error: "Code invalide." }

  const plainCodes = generateBackupCodes()
  const hashedCodes = await Promise.all(plainCodes.map((c) => bcrypt.hash(c, 12)))

  await prisma.$transaction([
    prisma.twoFactorBackupCode.deleteMany({ where: { userId: session.id } }),
    prisma.twoFactorBackupCode.createMany({
      data: hashedCodes.map((codeHash) => ({ userId: session.id, codeHash })),
    }),
  ])

  await logTwoFactorEvent(session.associationId, session.id, "TWO_FACTOR_BACKUP_REGENERATED", user.name ?? user.email)
  return { ok: true, backupCodes: plainCodes }
}

// ── Login step 2: verify the second factor and complete sign-in ────────────────────

async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const normalised = code.replace(/\s/g, "").toUpperCase()
  const codes = await prisma.twoFactorBackupCode.findMany({
    where:  { userId, usedAt: null },
    select: { id: true, codeHash: true },
  })
  for (const bc of codes) {
    if (await bcrypt.compare(normalised, bc.codeHash)) {
      await prisma.twoFactorBackupCode.update({ where: { id: bc.id }, data: { usedAt: new Date() } })
      return true
    }
  }
  return false
}

export type TwoFactorMethod = "totp" | "backup"

export async function verifyTwoFactorLogin(
  pendingToken: string,
  code: string,
  method: TwoFactorMethod,
): Promise<Result> {
  const pending: PendingLogin | null = await getPendingLogin(pendingToken)
  if (!pending) return { ok: false, error: "Session expirée. Veuillez recommencer la connexion." }

  // Keyed by userId, not by pendingToken: a token is single-use per successful sign-in,
  // but a fresh one is minted on every password resubmission (see authenticate() in
  // actions.ts) — keying the limit by token would let anyone who already knows the
  // password brute-force the 6-digit code indefinitely just by resubmitting it to get a
  // new token each time the old one's attempt budget ran out.
  const allowed = await rateLimit(`2fa-login:${pending.userId}`, 8, 15 * 60 * 1000)
  if (!allowed) return { ok: false, error: "Trop de tentatives. Veuillez recommencer la connexion." }

  const user = await prisma.user.findUnique({
    where:  { id: pending.userId, deletedAt: null },
    select: { id: true, associationId: true, twoFactorEnabled: true, twoFactorSecret: true, name: true, email: true },
  })
  if (!user || !user.twoFactorEnabled) return { ok: false, error: "Session invalide." }

  const verified = method === "totp"
    ? !!user.twoFactorSecret && verifyTotpCode(code, user.twoFactorSecret)
    : await consumeBackupCode(user.id, code)

  if (!verified) {
    await logTwoFactorEvent(user.associationId, user.id, "LOGIN_FAILED", user.name ?? user.email)
    return { ok: false, error: "Code invalide ou expiré." }
  }

  // The second factor is now checked — done with the "awaiting code" record, and about to
  // mint a fresh single-use "verified" one for authorize() to actually redeem (see
  // getVerifiedLogin's doc comment in two-factor-store.ts for why this can't just reuse
  // pendingToken: that value already went back to the browser once, in the requires2FA
  // response, before the code was ever checked).
  await clearPendingLogin(pendingToken)
  const verifiedToken = randomBytes(32).toString("hex")
  await setVerifiedLogin(verifiedToken, pending)

  // Logged before signIn(), not after — a successful signIn() with redirectTo throws
  // Next.js's internal NEXT_REDIRECT to perform the navigation, so nothing past that call
  // ever runs on the success path (same reasoning as authenticate() in actions.ts).
  await logTwoFactorEvent(user.associationId, user.id, "LOGIN_SUCCESS", user.name ?? user.email)

  const defaultRedirect = pending.slug ? `/portal/${pending.slug}` : "/dashboard"
  try {
    await signIn("credentials", {
      twoFactorToken: verifiedToken,
      redirectTo: `${BASE_PATH}${pending.callbackUrl ?? defaultRedirect}`,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      console.error("[2fa] signIn failed:", error.type, error.cause ?? error)
      return { ok: false, error: "Erreur lors de la connexion." }
    }
    throw error
  }

  return { ok: true }
}

// Lets the challenge screen's "back" action drop the pending record instead of leaving it
// to expire on its own — purely tidiness (the token is already useless to anyone but the
// browser that received it, and it self-expires either way), not a security fix.
export async function cancelTwoFactorLogin(pendingToken: string): Promise<void> {
  await clearPendingLogin(pendingToken)
}
