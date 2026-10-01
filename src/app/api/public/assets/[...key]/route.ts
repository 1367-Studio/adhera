import { NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { r2 } from "@/lib/r2"
import { rateLimit } from "@/lib/rate-limit"

// Fronts R2 objects through the app's own (already-trusted) domain instead of
// R2_PUBLIC_URL directly. R2_PUBLIC_URL today is Cloudflare's r2.dev development
// subdomain — explicitly not meant for production traffic, and subject to anti-abuse
// throttling for non-browser fetchers. Apple Mail's "Mail Privacy Protection" pre-fetches
// every remote <img> through Apple's own proxy before the recipient ever opens the
// message; when that proxy's request got throttled, the image just silently never
// appeared, with no broken-image icon. See src/lib/r2.ts's toProxiedAssetUrl().
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params
  const key = segments.join("/")

  // Keyed by the object key, not IP — mail clients/providers (Apple, Gmail) refetch the
  // same image from many different recipients' opens, same reasoning as the ticket QR
  // route's rate limit.
  if (!(await rateLimit(`public-asset:${key}`, 500, 10 * 60_000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  let object
  try {
    object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }))
  } catch (error: unknown) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
    if (statusCode === 404) return NextResponse.json({ error: "Not found" }, { status: 404 })
    throw error
  }
  if (!object.Body) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Streamed straight through rather than buffered into memory first — same pattern as
  // the authenticated CV-download route.
  return new NextResponse(object.Body.transformToWebStream(), {
    headers: {
      "Content-Type":  object.ContentType || "application/octet-stream",
      // The key is random (see uploadToR2) — the object behind it never changes in place.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
