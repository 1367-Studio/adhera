import { NextResponse } from "next/server"
import { uploadToR2 } from "@/lib/r2"
import { withPortalAuth } from "@/lib/api-wrapper"

const MAX_SIZE = 5 * 1024 * 1024 // 5 MB — portal fica mais restrito que o admin (10 MB)

function sniffFileType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg"
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])))
    return "image/png"
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")))
    return "image/gif"
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp"
  return null
}

export const POST = withPortalAuth(async (req) => {
  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 })
  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: "Fichier trop volumineux (max 5 Mo)" }, { status: 400 })

  const buffer      = Buffer.from(await file.arrayBuffer())
  const contentType = sniffFileType(buffer)
  if (!contentType)
    return NextResponse.json({ error: "Format non supporté. JPG, PNG, WebP ou GIF uniquement." }, { status: 400 })

  try {
    // prefix is hardcoded, not client-supplied — unlike the admin endpoint, the portal
    // caller has no legitimate reason to write anywhere other than membres/, and taking
    // the prefix from the request body would let a member-authenticated call write into
    // other folders in the same bucket.
    const url = await uploadToR2(buffer, "membres", contentType)
    return NextResponse.json({ url })
  } catch (err) {
    console.error("Upload error:", err)
    return NextResponse.json({ error: "Erreur lors de l'upload" }, { status: 500 })
  }
})
