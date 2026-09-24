// Deliberately import-free: shared by the association-document API routes and the editor's
// PDF upload, so it has to be safe inside a browser bundle.

// The /api/upload `prefix` a legal document's PDF is stored under. The API only accepts a
// fileUrl inside this prefix (src/lib/legal/document-file.ts), so a manager cannot point a
// legal document at an arbitrary URL or at another feature's uploads.
export const ASSOCIATION_DOCUMENT_FILE_PREFIX = "association-documents"
