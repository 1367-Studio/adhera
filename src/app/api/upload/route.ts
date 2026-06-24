import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { uploadToR2 } from "@/lib/r2"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_SIZE = 5 * 1024 * 1024 // 5 MB

type SessionUser = { id?: string }

export async function POST(req: Request) {
  const session = await auth()
  if (!(session?.user as SessionUser)?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
  }

  const formData = await req.formData()
  const file     = formData.get("file")   as File   | null
  const prefix   = (formData.get("prefix") as string) || "adhera"

  if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type))
    return NextResponse.json({ error: "Format non supporté. JPG, PNG, WebP ou GIF uniquement." }, { status: 400 })
  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: "Fichier trop volumineux (max 5 Mo)" }, { status: 400 })

  try {
    const url = await uploadToR2(file, prefix)
    return NextResponse.json({ url })
  } catch (err) {
    console.error("Upload error:", err)
    return NextResponse.json({ error: "Erreur lors de l'upload" }, { status: 500 })
  }
}
