import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand, type S3ClientConfig } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomBytes } from "crypto"
import { reportError } from "@/lib/monitoring"

const R2_CLIENT_CONFIG: S3ClientConfig = {
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
}

export const r2 = new S3Client(R2_CLIENT_CONFIG)

// Presigned PUT URLs need their own client: under the SDK's default checksum mode
// ("WHEN_SUPPORTED"), getSignedUrl bakes the CRC32 of an *empty* body into the URL
// (x-amz-checksum-crc32=AAAAAA==), which the browser's real upload can never match. The shared
// `r2` client above keeps its defaults for the server-side uploads that already work with them.
const r2PresignClient = new S3Client({ ...R2_CLIENT_CONFIG, requestChecksumCalculation: "WHEN_REQUIRED" })

export const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg":     "jpg",
  "image/png":      "png",
  "image/webp":     "webp",
  "image/gif":      "gif",
  "application/pdf": "pdf",
}

// `buffer` and `contentType` should come from server-side content sniffing, not from the
// client-supplied filename/Content-Type header — those are trivially spoofable.
export async function uploadToR2(buffer: Buffer, prefix: string, contentType: string): Promise<string> {
  const ext = EXT_BY_CONTENT_TYPE[contentType] || "bin"
  const key = `${prefix}/${randomBytes(8).toString("hex")}.${ext}`

  await r2.send(
    new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET_NAME!,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    }),
  )

  return `${process.env.R2_PUBLIC_URL}/${key}`
}

// For uploads too large to pass through a serverless function body (Vercel caps those at
// 4.5 MB): the browser PUTs the file straight to R2 with this URL. Content-Type and
// Content-Length are signed into it — the presigner leaves content-type unsigned by default —
// so the client can't upload a bigger file, or a different type, than the one it declared.
// The declared type is still only a claim: whoever later relies on the file must sniff its
// real bytes (see src/lib/email-attachments.ts).
export async function createPresignedUploadUrl(options: {
  key:              string
  contentType:      string
  contentLength:    number
  expiresInSeconds: number
}): Promise<string> {
  return getSignedUrl(
    r2PresignClient,
    new PutObjectCommand({
      Bucket:        process.env.R2_BUCKET_NAME!,
      Key:           options.key,
      ContentType:   options.contentType,
      ContentLength: options.contentLength,
    }),
    { expiresIn: options.expiresInSeconds, signableHeaders: new Set(["content-type", "content-length"]) },
  )
}

// Only a 404 means "no such object" — any other failure (bad credentials, an R2 outage) is
// rethrown by the helpers below, so a transient error isn't reported as a missing file.
function isR2NotFound(error: unknown): boolean {
  const statusCode = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
  return statusCode === 404
}

// The object's real stored size, or null when it doesn't exist.
export async function getR2ObjectSize(key: string): Promise<number | null> {
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }))
    return head.ContentLength ?? 0
  } catch (error: unknown) {
    if (isR2NotFound(error)) return null
    throw error
  }
}

// The object's first `byteCount` bytes (fewer if the object is smaller) via a ranged GET —
// enough to sniff magic bytes without downloading the whole file. Null when it doesn't exist.
export async function readR2ObjectFirstBytes(key: string, byteCount: number): Promise<Buffer | null> {
  try {
    const object = await r2.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key:    key,
      Range:  `bytes=0-${byteCount - 1}`,
    }))
    return Buffer.from(await object.Body?.transformToByteArray() ?? [])
  } catch (error: unknown) {
    if (isR2NotFound(error)) return null
    throw error
  }
}

export async function deleteFromR2(url: string): Promise<void> {
  try {
    const { pathname } = new URL(url)
    const key = pathname.slice(1)
    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }))
  } catch (error) {
    // ignore if already deleted
    if (!isR2NotFound(error)) reportError(error, { area: "storage", action: "r2.delete" })
  }
}
