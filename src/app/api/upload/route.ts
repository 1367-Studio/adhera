import { NextResponse } from "next/server"
import { uploadToR2 } from "@/lib/r2"
import { sniffFileType } from "@/lib/file-sniff"
import { withAdminAuth } from "@/lib/api-wrapper"
import { MAX_FUNCTION_UPLOAD_BYTES } from "@/lib/upload-limits"
import { reportError } from "@/lib/monitoring"

// Shares MAX_FUNCTION_UPLOAD_BYTES with the client-side checks (document-upload.tsx,
// image-upload.tsx, expenses-view.tsx) — a mismatch means the client accepts a file the
// server then silently rejects.
const MAX_SIZE = MAX_FUNCTION_UPLOAD_BYTES

// Staff-wide (no single area): every area of the dashboard uploads its files through this
// route, so it can't be gated on one specific area. It used to be ADMIN/PRESIDENT/TRESORIER/
// SECRETAIRE only — an EQUIPE member (no bureau position) couldn't upload at all. Kept
// equivalent here: at least edit access somewhere, so a volunteer granted zero areas still
// can't push files into storage they then have nothing to attach them to.
//
// FORM-93 exception: a volunteer granted zero areas can still create their OWN reimbursement
// request (unconditional on any staff role — see reimbursement-access.ts), and that request's
// items each need a mandatory receipt. Without this, the "at least one edit area" rule above
// would block the one upload they actually do have something to attach to.
export const POST = withAdminAuth(async (req, ctx) => {
  const formData = await req.formData()
  const file     = formData.get("file")   as File   | null
  const prefix   = (formData.get("prefix") as string) || "adhera"

  const canUpload = ctx.permissions.administrator
    || Object.values(ctx.permissions.areas).some(level => level === "edit")
    || prefix === "reimbursement-receipts"
  if (!canUpload) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 })
  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: "Fichier trop volumineux (max 4 Mo)" }, { status: 400 })

  const buffer      = Buffer.from(await file.arrayBuffer())
  const contentType = sniffFileType(buffer)
  if (!contentType)
    return NextResponse.json({ error: "Format non supporté. JPG, PNG, WebP, GIF ou PDF uniquement." }, { status: 400 })

  try {
    const url = await uploadToR2(buffer, prefix, contentType)
    return NextResponse.json({ url })
  } catch (error) {
    reportError(error, { area: "storage", action: "upload.r2", extra: { associationId: ctx.associationId } })
    return NextResponse.json({ error: "Erreur lors de l'upload" }, { status: 500 })
  }
})
