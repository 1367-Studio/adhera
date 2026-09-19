import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { createPresignedUploadUrl } from "@/lib/r2"
import {
  EMAIL_ATTACHMENT_CONTENT_TYPES,
  EMAIL_ATTACHMENT_ERRORS,
  EMAIL_ATTACHMENT_UPLOAD_URL_TTL_SECONDS,
  MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES,
  buildEmailAttachmentKey,
} from "@/lib/email-attachments"

// Same roles as the send route itself (../route.ts) — only someone who can send the email
// has any reason to upload its attachments.
const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

// `filename` isn't part of the key (that's random) — the original name travels with the send
// request instead, which is where it gets sanitized. It's still bounded here so the client
// can't declare something the send route would then reject.
const schema = z.object({
  filename:    z.string().min(1, "Nom de fichier manquant.").max(255, "Nom de fichier trop long (255 caractères maximum)."),
  size:        z.number().int().min(1, "Le fichier est vide.").max(MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES, EMAIL_ATTACHMENT_ERRORS.tooLarge),
  contentType: z.enum(EMAIL_ATTACHMENT_CONTENT_TYPES, EMAIL_ATTACHMENT_ERRORS.unsupported),
})

// Step 1 of attaching a file to a bulk email: returns a short-lived presigned URL the browser
// PUTs the file to directly, so the bytes never pass through a function (Vercel caps their
// request bodies at 4.5 MB). The declared size and type are signed into that URL; the send
// route re-verifies both against the stored object anyway (src/lib/email-attachments.ts).
export const POST = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  // Checks without their own message above (a wrong JSON type, a non-integer size) fall
  // back to the generic one rather than zod's English defaults.
  const parsed = schema.safeParse(body, { error: () => "Données invalides" })
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 })

  const { size, contentType } = parsed.data
  const key = buildEmailAttachmentKey(ctx.associationId, contentType)

  try {
    const uploadUrl = await createPresignedUploadUrl({
      key,
      contentType,
      contentLength:    size,
      expiresInSeconds: EMAIL_ATTACHMENT_UPLOAD_URL_TTL_SECONDS,
    })
    return NextResponse.json({ uploadUrl, key })
  } catch (error: unknown) {
    console.error("[membres/email/attachments] presign error:", error)
    return NextResponse.json({ error: "Erreur lors de la préparation de l'envoi du fichier" }, { status: 500 })
  }
}, { module: "messages" })
