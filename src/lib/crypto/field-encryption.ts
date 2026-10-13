import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto"

// Encrypts BYOK third-party credentials (Twilio/LiveKit/AI API keys) and the 2FA TOTP
// secret before they ever reach the DB (security audit H8/L3) — today a DB dump exposes
// every association's live, reusable credentials to their own third-party accounts in
// plain text, and every staff member's TOTP seed with it.
//
// Deliberately tolerant on read (`decryptField` returns a value unchanged if it doesn't
// carry the PREFIX below) and fails open to plaintext on write when ENCRYPTION_KEY isn't
// set yet — this lets the code ship ahead of the key existing in every environment and
// ahead of a backfill of already-stored plaintext rows, instead of requiring both to land
// in the same deploy. Existing plaintext rows keep working (as plaintext) until a
// separate backfill script re-saves them through encryptField.

const ALGORITHM = "aes-256-gcm"
const PREFIX    = "enc:v1:"
const IV_BYTES  = 12
const TAG_BYTES = 16

let warnedMissingKey = false

function getKey(): Buffer | null {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    // Logged once per cold start, not per-field — same "loud once" pattern as the Upstash
    // misconfiguration check in rate-limit.ts.
    if (!warnedMissingKey) {
      console.error(
        "[field-encryption] MISCONFIGURED: ENCRYPTION_KEY not set — every BYOK credential " +
        "(Twilio/LiveKit/AI API keys) and the 2FA secret are being stored/read in PLAINTEXT " +
        "until this is fixed."
      )
      warnedMissingKey = true
    }
    return null
  }
  // Normalises any passphrase length into a valid 32-byte AES-256 key — no base64/hex
  // formatting required from whoever sets the env var.
  return createHash("sha256").update(secret).digest()
}

export function encryptField(value: string): string {
  const key = getKey()
  if (!key) return value

  const iv        = randomBytes(IV_BYTES)
  const cipher     = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const authTag    = cipher.getAuthTag()

  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64")
}

export function decryptField(value: string): string {
  if (!value.startsWith(PREFIX)) return value

  const key = getKey()
  if (!key) return value

  const raw        = Buffer.from(value.slice(PREFIX.length), "base64")
  const iv          = raw.subarray(0, IV_BYTES)
  const authTag     = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext  = raw.subarray(IV_BYTES + TAG_BYTES)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

export function encryptNullable(value: string | null | undefined): string | null | undefined {
  return value == null ? value : encryptField(value)
}

export function decryptNullable(value: string | null | undefined): string | null | undefined {
  return value == null ? value : decryptField(value)
}
