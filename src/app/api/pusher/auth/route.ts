import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { pusherServer } from "@/lib/pusher-server"

type SessionUser = {
  id?:            string
  associationId?: string | null
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  const form        = await req.formData()
  const socketId    = form.get("socket_id") as string
  const channelName = form.get("channel_name") as string

  if (channelName.startsWith("private-association-")) {
    const channelAssocId = channelName.replace("private-association-", "")
    if (u.associationId !== channelAssocId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const authResponse = pusherServer.authorizeChannel(socketId, channelName)
  return NextResponse.json(authResponse)
}
