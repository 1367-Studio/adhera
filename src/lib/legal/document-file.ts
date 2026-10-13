import { ASSOCIATION_DOCUMENT_FILE_PREFIX } from "@/lib/association-document-file"
import { extractR2Key } from "@/lib/r2"

// A legal document's fileUrl is accepted only if /api/upload produced it under the documents
// prefix. The ".pdf" suffix is proof enough of the type: uploadToR2 (src/lib/r2.ts) derives
// the extension from server-side content sniffing, never from the client's filename, so a key
// ending in ".pdf" was sniffed as a PDF.
//
// The R2 objects behind these URLs are never deleted — not when the PDF is replaced, removed,
// or the document soft-deleted — because an accepted AssociationDocumentRevision may still
// point at them as evidence of what someone agreed to.
//
// extractR2Key resolves the stored URL whichever shape it's in (legacy direct R2_PUBLIC_URL,
// or the app-domain proxy uploadToR2 returns today) down to its bare key; the part after the
// prefix must then be exactly the random key uploadToR2 generates (16 hex characters), so
// "../", extra path segments or a query string can't smuggle in another object.
const UPLOADED_KEY_PATTERN = new RegExp(`^${ASSOCIATION_DOCUMENT_FILE_PREFIX}/[0-9a-f]{16}\\.pdf$`)

export function isAssociationDocumentFileUrl(url: string): boolean {
  const key = extractR2Key(url)
  return key !== null && UPLOADED_KEY_PATTERN.test(key)
}
