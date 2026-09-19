// Content types the admin upload route (src/app/api/upload/route.ts) and bulk email
// attachments (src/lib/email-attachments.ts) both accept.
export type SniffedFileType = "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf"

// How many leading bytes a caller that only fetches the start of a file (e.g. a ranged R2
// GetObject) should read — covers the longest signature checked below (WebP: "RIFF" + 4 size
// bytes + "WEBP" = 12) with some margin.
export const FILE_SNIFF_HEADER_BYTES = 16

// Sniff the real file type from its magic bytes — the client-supplied filename/
// Content-Type are trivially spoofable and shouldn't decide what gets stored/served.
export function sniffFileType(buffer: Buffer): SniffedFileType | null {
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg"
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])))
    return "image/png"
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")))
    return "image/gif"
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp"
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf"
  return null
}
