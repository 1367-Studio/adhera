/**
 * Native TOTP implementation (RFC 6238) using Node.js built-in crypto.
 * No external dependencies.
 */
import { createHmac, randomBytes } from "crypto"

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes)
  let result = ""
  let bits = 0
  let value = 0
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 31]
  }
  return result
}

function base32Decode(input: string): Buffer {
  const str = input.toUpperCase().replace(/=+$/, "")
  const bytes: number[] = []
  let buffer = 0
  let bitsLeft = 0
  for (const char of str) {
    const idx = BASE32_CHARS.indexOf(char)
    if (idx < 0) continue
    buffer = (buffer << 5) | idx
    bitsLeft += 5
    if (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 0xff)
      bitsLeft -= 8
    }
  }
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret)
  const buf = Buffer.alloc(8)
  let tmp = counter
  for (let i = 7; i >= 0; i--) {
    buf[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }
  const hmac = createHmac("sha1", key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(code % 10 ** digits).padStart(digits, "0")
}

// window=1 accepts the previous and next 30s window (handles clock skew)
export function verifyTotpCode(token: string, secret: string, window = 1): boolean {
  try {
    const counter = Math.floor(Date.now() / 1000 / 30)
    for (let i = -window; i <= window; i++) {
      if (hotp(secret, counter + i) === token) return true
    }
    return false
  } catch {
    return false
  }
}

export function generateTotpUri(email: string, secret: string): string {
  const issuer = encodeURIComponent("Formwise")
  const account = encodeURIComponent(email)
  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
}
