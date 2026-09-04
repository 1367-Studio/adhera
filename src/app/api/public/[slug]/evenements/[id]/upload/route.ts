import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { uploadToR2 } from "@/lib/r2"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// Same limit as the admin's own DocumentUpload route (src/app/api/upload/route.ts) — this one
// is more restricted in scope (see the FILE-field gate below), not in size.
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

// Duplicated rather than shared — same convention as src/app/api/upload/route.ts,
// src/app/api/portal/upload/route.ts and the adhesion form's own photo route: sniffs the real
// file type from its magic bytes, since the client-supplied filename/Content-Type are
// trivially spoofable. Only jpeg/png/webp/pdf here — no gif, this route is for admin-defined
// document/photo attachments, not arbitrary images.
function sniffFileType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg"
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])))
    return "image/png"
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp"
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf"
  return null
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  // Rate-limited by IP — this route is reachable with no authentication at all, same
  // exposure as the adhesion form's own public photo route.
  if (!(await rateLimit(`evenement-upload:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, sitePublished: true, modules: true },
  })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const mods = parseModules(assoc.modules)
  if (!mods.site || !mods.evenements) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  // Only accepted when the event is actually live AND has a FILE custom field configured —
  // without this second check, an open unauthenticated upload endpoint would be reachable
  // independently of any real registration context, i.e. a free file host for anyone who
  // finds the URL.
  const evenement = await prisma.evenement.findFirst({
    where:  { id, associationId: assoc.id, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
    select: { customFields: { where: { type: "FILE" }, select: { id: true }, take: 1 } },
  })
  if (!evenement || evenement.customFields.length === 0)
    return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 })
  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)" }, { status: 400 })

  const buffer      = Buffer.from(await file.arrayBuffer())
  const contentType = sniffFileType(buffer)
  if (!contentType)
    return NextResponse.json({ error: "Format non supporté. JPG, PNG, WebP ou PDF uniquement." }, { status: 400 })

  try {
    const url = await uploadToR2(buffer, "evenements", contentType)
    return NextResponse.json({ url })
  } catch (err) {
    console.error("Upload error:", err)
    return NextResponse.json({ error: "Erreur lors de l'upload" }, { status: 500 })
  }
}
