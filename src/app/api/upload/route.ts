import { NextResponse } from "next/server"
import { uploadToR2 } from "@/lib/r2"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
// Kept in sync with the client-side check in src/components/ui/document-upload.tsx —
// a mismatch here means the client accepts a file the server then silently rejects.
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

// Sniff the real file type from its magic bytes — the client-supplied filename/
// Content-Type are trivially spoofable and shouldn't decide what gets stored/served.
function sniffFileType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg"
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])))
    return "image/png"
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")))
    return "image/gif"
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp"
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf"
  return null
}

export const POST = withAdminAuth(async (req) => {
  const formData = await req.formData()
  const file     = formData.get("file")   as File   | null
  const prefix   = (formData.get("prefix") as string) || "adhera"

  if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 })
  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)" }, { status: 400 })

  const buffer      = Buffer.from(await file.arrayBuffer())
  const contentType = sniffFileType(buffer)
  if (!contentType)
    return NextResponse.json({ error: "Format non supporté. JPG, PNG, WebP, GIF ou PDF uniquement." }, { status: 400 })

  try {
    const url = await uploadToR2(buffer, prefix, contentType)
    return NextResponse.json({ url })
  } catch (err) {
    console.error("Upload error:", err)
    return NextResponse.json({ error: "Erreur lors de l'upload" }, { status: 500 })
  }
}, { roles: MANAGERS })
