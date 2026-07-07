import { NextResponse } from "next/server"
import { z } from "zod"
import { RoomServiceClient } from "livekit-server-sdk"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  livekitUrl:       z.string().min(1),
  livekitApiKey:    z.string().min(1),
  livekitApiSecret: z.string().min(1),
})

// Validates a LiveKit URL/key/secret triple before it's saved, so a typo surfaces here
// instead of showing up later as a cryptic "Impossible de rejoindre la réunion" in the
// middle of a real meeting. listRooms() is a cheap read-only call that just needs the
// credentials to be valid for the given project — it doesn't require any room to exist.
export const POST = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Champs manquants" }, { status: 400 })

  const { livekitUrl, livekitApiKey, livekitApiSecret } = parsed.data

  try {
    const client = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret)
    await client.listRooms()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: "Connexion impossible — vérifiez l'URL, la clé et le secret." }, { status: 200 })
  }
})
