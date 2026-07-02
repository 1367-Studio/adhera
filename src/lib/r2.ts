import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { randomBytes } from "crypto"

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif",
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

export async function deleteFromR2(url: string): Promise<void> {
  try {
    const { pathname } = new URL(url)
    const key = pathname.slice(1)
    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }))
  } catch {
    // ignore if already deleted
  }
}
