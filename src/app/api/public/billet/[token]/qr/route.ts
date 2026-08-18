import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// PNG of the ticket's QR code, embedded via <img> in confirmation emails — mail clients
// strip data: URIs, so the image must be served from a real URL. The QR encodes the
// public /billet/[token] page URL: a phone camera opens the ticket, and the organizer
// scanner (dashboard présences → scanner) extracts the token from it to validate entry.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  // More generous than billet-info: mail clients and proxies (Gmail) may refetch the
  // image; it stays cheap because invalid tokens never reach the QR encoder.
  if (!(await rateLimit(`billet-qr:${requestIp(req)}`, 60, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }
  if (!/^[0-9a-f]{40}$/.test(token)) {
    return NextResponse.json({ error: "Billet introuvable" }, { status: 404 })
  }

  const participation = await prisma.participation.findUnique({
    where:  { ticketToken: token },
    select: { id: true },
  })
  if (!participation) return NextResponse.json({ error: "Billet introuvable" }, { status: 404 })

  const png = await QRCode.toBuffer(`${APP_URL}/billet/${token}`, {
    type:  "png",
    width: 480,
    margin: 2,
    errorCorrectionLevel: "M",
  })

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type":  "image/png",
      // The QR only depends on the token (immutable once issued) — cache aggressively.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  })
}
