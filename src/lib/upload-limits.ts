// Deliberately import-free: shared by the upload API routes and the client-side checks that
// mirror them, so it has to be safe inside a browser bundle.

// Every upload that sends the file itself through a Next API route (multipart formData) is
// bounded by Vercel's serverless request-body cap (~4.5 MB, not overridable via vercel.json).
// 4 MB leaves room for the multipart overhead around the file. Anything that must be larger
// has to skip the function entirely and go browser → R2 through a presigned PUT
// (createPresignedUploadUrl in src/lib/r2.ts, as the bulk email attachments already use).
// Those attachments are still capped at this same 4 MB total, so users see one limit everywhere.
export const MAX_FUNCTION_UPLOAD_BYTES = 4 * 1024 * 1024 // 4 MB
