import { NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma/client"
import { r2, extractR2Key } from "@/lib/r2"
import { rateLimit } from "@/lib/rate-limit"

// Streams a public legal document's PDF bytes directly, instead of handing the browser
// fileUrl (the raw stored R2 URL) the way ../route.ts used to. Unlike the generic
// /api/public/assets/[...key] proxy — which serves any key with no database check at all —
// this route re-runs the exact same visibleToPublic lookup on every single request, so
// unpublishing a document in the admin takes effect immediately for anyone still holding this
// URL, instead of only for future page loads.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  if (!(await rateLimit(`public-document-file:${id}`, 500, 10 * 60_000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const assoc = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Same non-disclosure rule as ../route.ts: missing, soft-deleted, not-visible and another
  // association's documents all answer the same 404.
  const document = await prisma.associationDocument.findFirst({
    where:  { id, associationId: assoc.id, deletedAt: null, visibleToPublic: true },
    select: { fileUrl: true, fileName: true },
  })
  if (!document?.fileUrl) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const key = extractR2Key(document.fileUrl)
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let object
  try {
    object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }))
  } catch (error: unknown) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
    if (statusCode === 404) return NextResponse.json({ error: "Not found" }, { status: 404 })
    throw error
  }
  if (!object.Body) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return new NextResponse(object.Body.transformToWebStream(), {
    headers: {
      "Content-Type": "application/pdf",
      // Short-lived on purpose, unlike the assets route's immutable caching — the response
      // here can flip from 200 to 404 the moment an admin unpublishes the document, and a
      // long-cached copy would keep serving it anyway.
      "Cache-Control": "private, max-age=60",
      ...(document.fileName
        ? { "Content-Disposition": `inline; filename="${document.fileName.replace(/"/g, "")}"` }
        : {}),
    },
  })
}
