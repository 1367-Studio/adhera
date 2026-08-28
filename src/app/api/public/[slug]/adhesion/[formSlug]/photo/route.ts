import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { uploadToR2 } from "@/lib/r2"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// Most restrictive of the app's 3 upload routes (admin 10 MB, portal 5 MB) — this one is the
// only one reachable without any authentication at all.
const MAX_SIZE = 5 * 1024 * 1024 // 5 MB

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
) {
  const { slug, formSlug } = await params

  if (!(await rateLimit(`membership-form-photo:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  // Only accepted when the form actually asks for a photo — an open, unauthenticated upload
  // endpoint must never be reachable independently of a real signup context.
  const assoc = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const form = await prisma.membershipForm.findFirst({
    where:  { slug: formSlug, associationId: assoc.id, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
    select: { fieldPhoto: true },
  })
  if (!form || form.fieldPhoto === "HIDDEN")
    return NextResponse.json({ error: "Formulaire introuvable" }, { status: 404 })

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
    // Same destination folder as the portal's own member-photo uploads — this photo becomes
    // Membre.photoUrl exactly like one uploaded later from the portal.
    const url = await uploadToR2(buffer, "membres", contentType)
    return NextResponse.json({ url })
  } catch (err) {
    console.error("Upload error:", err)
    return NextResponse.json({ error: "Erreur lors de l'upload" }, { status: 500 })
  }
}
