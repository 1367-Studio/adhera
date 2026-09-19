import { randomBytes } from "crypto"
import { EXT_BY_CONTENT_TYPE, getR2ObjectSize, readR2ObjectFirstBytes } from "@/lib/r2"
import { FILE_SNIFF_HEADER_BYTES, sniffFileType, type SniffedFileType } from "@/lib/file-sniff"
import { MAX_FUNCTION_UPLOAD_BYTES } from "@/lib/upload-limits"

// Bulk member email attachments ("Envoyer un email"): the browser uploads each file straight
// to R2 through a presigned URL (src/app/api/membres/email/attachments/route.ts), then the
// send request (src/app/api/membres/email/route.ts) only references the resulting keys —
// everything the browser declared along the way is re-checked here before anything is sent.

// Total across every file of one email, not per file. Deliberately equal to the app-wide
// upload limit so users see one number everywhere — even though this path never sends the
// bytes through a function (so Vercel's request-body cap doesn't apply) and Resend's own cap
// is far higher (40 MB after base64), so it could technically allow more.
export const MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES = MAX_FUNCTION_UPLOAD_BYTES
export const MAX_EMAIL_ATTACHMENTS_COUNT       = 10
export const EMAIL_ATTACHMENT_KEY_PREFIX       = "email-attachments"
// Long enough for a slow connection to finish a 4 MB upload, short enough that a leaked
// URL stops working soon after.
export const EMAIL_ATTACHMENT_UPLOAD_URL_TTL_SECONDS = 600

export const EMAIL_ATTACHMENT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const satisfies readonly SniffedFileType[]

export type EmailAttachmentContentType = (typeof EMAIL_ATTACHMENT_CONTENT_TYPES)[number]

export const EMAIL_ATTACHMENT_ERRORS = {
  invalid:     "Pièce jointe invalide. Veuillez la réajouter.",
  duplicate:   "Une même pièce jointe a été ajoutée plusieurs fois.",
  notFound:    "Une pièce jointe est introuvable. Veuillez la réajouter.",
  tooLarge:    "Pièces jointes trop volumineuses (4 Mo maximum au total).",
  tooMany:     "10 pièces jointes maximum.",
  unsupported: "Format de pièce jointe non supporté. JPG, PNG, WebP, GIF ou PDF uniquement.",
  unavailable: "Impossible de vérifier les pièces jointes. Veuillez réessayer.",
} as const

// What the browser sends back after uploading: the key it was handed plus the file's
// original name — never a size or a type, since neither would be trusted anyway.
export type EmailAttachmentReference = { key: string; filename: string }

// Metadata only (no bytes) — this is what travels in the Inngest event, whose payloads are
// size-limited; Resend later fetches each file from `url` itself.
export type VerifiedEmailAttachment = { url: string; filename: string; contentType: EmailAttachmentContentType; size: number }

export type EmailAttachmentVerification =
  | { ok: true;  attachments: VerifiedEmailAttachment[] }
  | { ok: false; error: string; status: 400 | 500 }

export function buildEmailAttachmentKey(associationId: string, contentType: EmailAttachmentContentType): string {
  return `${EMAIL_ATTACHMENT_KEY_PREFIX}/${associationId}/${randomBytes(16).toString("hex")}.${EXT_BY_CONTENT_TYPE[contentType]}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Exactly the shape buildEmailAttachmentKey produces, under the caller's own association —
// so a request can't point the email at another association's upload, or at an arbitrary
// object elsewhere in the bucket.
function buildEmailAttachmentKeyPattern(associationId: string): RegExp {
  const extensions = EMAIL_ATTACHMENT_CONTENT_TYPES.map(contentType => EXT_BY_CONTENT_TYPE[contentType]).join("|")
  return new RegExp(`^${escapeRegExp(EMAIL_ATTACHMENT_KEY_PREFIX)}/${escapeRegExp(associationId)}/[0-9a-f]{32}\\.(${extensions})$`)
}

const EXTENSIONS_BY_CONTENT_TYPE: Record<EmailAttachmentContentType, string[]> = {
  "image/jpeg":      ["jpg", "jpeg"],
  "image/png":       ["png"],
  "image/webp":      ["webp"],
  "image/gif":       ["gif"],
  "application/pdf": ["pdf"],
}

const MAX_ATTACHMENT_FILENAME_LENGTH = 120

// Control characters and quotes would break out of the MIME Content-Disposition header;
// the Windows-reserved <>:*?| would make the file unsavable on the recipient's machine; bidi
// overrides (U+202A–U+202E, U+2066–U+2069) are the classic trick for disguising an extension
// ("facture\u202Efdp.exe" displays as "factureexe.pdf").
const UNSAFE_FILENAME_CHARACTERS = /[\u0000-\u001F\u007F-\u009F"'`<>:*?|\u202A-\u202E\u2066-\u2069]/g

// Turns a client-supplied name into one safe to show as an email attachment name, whose
// extension always matches the sniffed type (appended when missing or wrong, e.g. a PNG
// renamed "photo.jpg" goes out as "photo.jpg.png"). `position` (1-based) only feeds the
// fallback name used when nothing usable is left.
export function sanitizeAttachmentFilename(rawFilename: string, contentType: EmailAttachmentContentType, position: number): string {
  const allowedExtensions  = EXTENSIONS_BY_CONTENT_TYPE[contentType]
  const canonicalExtension = allowedExtensions[0]
  const fallbackStem       = `piece-jointe-${position}`

  // Only the last path segment — a browser sends a bare name, but a crafted request could
  // send "../../x.pdf" or "C:\fakepath\x.pdf".
  const baseName = (rawFilename.split(/[\\/]/).pop() ?? "")
    .replace(/\s+/g, " ")                    // newlines/tabs become plain spaces first…
    .replace(UNSAFE_FILENAME_CHARACTERS, "") // …so stripping the rest can't glue words together
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/^\.+/, "") // no hidden-file or ".." names
    .trim()

  const dotIndex         = baseName.lastIndexOf(".")
  const currentExtension = dotIndex > 0 ? baseName.slice(dotIndex + 1) : ""
  const hasValidExtension = allowedExtensions.includes(currentExtension.toLowerCase())
  const stem      = hasValidExtension ? baseName.slice(0, dotIndex) : baseName
  const extension = hasValidExtension ? currentExtension : canonicalExtension

  // The stem is what gets capped, never the extension. Array.from splits by code point, so
  // an accented letter or emoji is never cut in half.
  const maxStemLength = MAX_ATTACHMENT_FILENAME_LENGTH - extension.length - 1
  const cappedStem    = Array.from(stem).slice(0, maxStemLength).join("").trim()

  return `${cappedStem || fallbackStem}.${extension}`
}

function isEmailAttachmentContentType(contentType: SniffedFileType | null): contentType is EmailAttachmentContentType {
  return (EMAIL_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(contentType ?? "")
}

// Re-checks every referenced upload against R2 itself: the key's shape (own association
// only), that the object exists, its real stored size (total cap), and its real type from
// its magic bytes — the browser's declared size/type at presign time are never trusted here.
export async function verifyEmailAttachments(associationId: string, references: EmailAttachmentReference[]): Promise<EmailAttachmentVerification> {
  if (!references.length) return { ok: true, attachments: [] }
  if (references.length > MAX_EMAIL_ATTACHMENTS_COUNT) return { ok: false, error: EMAIL_ATTACHMENT_ERRORS.tooMany, status: 400 }

  const keyPattern = buildEmailAttachmentKeyPattern(associationId)
  if (references.some(reference => !keyPattern.test(reference.key)))
    return { ok: false, error: EMAIL_ATTACHMENT_ERRORS.invalid, status: 400 }
  if (new Set(references.map(reference => reference.key)).size !== references.length)
    return { ok: false, error: EMAIL_ATTACHMENT_ERRORS.duplicate, status: 400 }

  // The HEAD (size) and ranged GET (magic bytes) of every file are independent — at most
  // 10 files × 2 small requests, all in flight at once.
  let inspections: { reference: EmailAttachmentReference; size: number | null; firstBytes: Buffer | null }[]
  try {
    inspections = await Promise.all(references.map(async reference => {
      const [size, firstBytes] = await Promise.all([
        getR2ObjectSize(reference.key),
        readR2ObjectFirstBytes(reference.key, FILE_SNIFF_HEADER_BYTES),
      ])
      return { reference, size, firstBytes }
    }))
  } catch (error: unknown) {
    console.error("[email-attachments] R2 verification failed:", error)
    return { ok: false, error: EMAIL_ATTACHMENT_ERRORS.unavailable, status: 500 }
  }

  if (inspections.some(inspection => inspection.size === null || inspection.firstBytes === null))
    return { ok: false, error: EMAIL_ATTACHMENT_ERRORS.notFound, status: 400 }

  const totalBytes = inspections.reduce((total, inspection) => total + (inspection.size ?? 0), 0)
  if (totalBytes > MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES)
    return { ok: false, error: EMAIL_ATTACHMENT_ERRORS.tooLarge, status: 400 }

  const attachments: VerifiedEmailAttachment[] = []
  for (const [index, inspection] of inspections.entries()) {
    const contentType = sniffFileType(inspection.firstBytes ?? Buffer.alloc(0))
    if (!isEmailAttachmentContentType(contentType))
      return { ok: false, error: EMAIL_ATTACHMENT_ERRORS.unsupported, status: 400 }

    attachments.push({
      url:         `${process.env.R2_PUBLIC_URL}/${inspection.reference.key}`,
      filename:    sanitizeAttachmentFilename(inspection.reference.filename, contentType, index + 1),
      contentType,
      size:        inspection.size ?? 0,
    })
  }

  return { ok: true, attachments }
}
