"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { UploadSimpleIcon, FileIcon, XIcon, ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { MAX_FUNCTION_UPLOAD_BYTES } from "@/lib/upload-limits"

const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf"
const PDF_MIME_TYPE  = "application/pdf"

interface DocumentUploadProps {
  value: string
  /** `file` is the picked File, handed along so a caller can keep its original name. It is
   *  absent when the value is cleared. */
  onChange: (url: string, file?: File) => void
  prefix?: string
  /** Native `accept` filter. A PDF-only value also rejects any other file once picked —
   *  the OS dialog lets people switch to "All files". */
  accept?: string
  /** Shown instead of the generic "PDF document" / "image receipt" label, e.g. the original
   *  file name the caller stored alongside the url. */
  fileLabel?: string | null
  /** Put on the file input so an external <Label htmlFor> and hint can describe it. */
  id?: string
  describedBy?: string
  /** When true, skips the immediate R2 upload. onChange receives a blob: URL for preview,
   *  and onFilePending is called with the File so the consumer can upload at save time —
   *  this avoids leaving an orphaned R2 object when the user picks a file, then removes it
   *  or cancels the form before ever saving (see [[project-devis-facture-fournisseur-modules]]). */
  lazy?: boolean
  onFilePending?: (blobUrl: string, file: File, prefix: string) => void
}

export function DocumentUpload({
  value, onChange, prefix = "receipts", accept = DEFAULT_ACCEPT, fileLabel, id, describedBy, lazy = false, onFilePending,
}: DocumentUploadProps) {
  const t = useTranslations("documentUpload")
  const [uploading, setUploading] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const blobUrlRef = useRef<string | null>(null)
  const pdfOnly    = accept === PDF_MIME_TYPE

  // `value` moving away from the blob URL we handed out — either the parent uploaded it
  // for real at save time and swapped in the R2 url, or the form was reset/cancelled —
  // means that blob is done being referenced anywhere and can be released.
  useEffect(() => {
    if (blobUrlRef.current && value !== blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
      setPendingFile(null)
    }
  }, [value])

  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current) }, [])

  async function handleFile(file: File) {
    if (pdfOnly && file.type !== PDF_MIME_TYPE) {
      toast.error(t("pdfOnly"))
      if (inputRef.current) inputRef.current.value = ""
      return
    }
    if (file.size > MAX_FUNCTION_UPLOAD_BYTES) { toast.error(t("fileTooLarge")); return }

    if (lazy) {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      const blobUrl = URL.createObjectURL(file)
      blobUrlRef.current = blobUrl
      setPendingFile(file)
      onFilePending?.(blobUrl, file, prefix)
      onChange(blobUrl, file)
      if (inputRef.current) inputRef.current.value = ""
      return
    }

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("prefix", prefix)
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? t("uploadError"))
        return
      }
      const { url } = await res.json()
      onChange(url, file)
    } catch {
      // fetch itself throwing (offline, DNS failure, timeout) — without this the upload
      // silently resets with no feedback, and the user has no idea it failed.
      toast.error(t("networkError"))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function handleRemove() {
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }
    setPendingFile(null)
    onChange("")
  }

  const isPdf = pendingFile
    ? pendingFile.type === "application/pdf"
    : value.toLowerCase().includes(".pdf") || value.toLowerCase().includes("application%2Fpdf")

  if (value) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/30 px-3">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm">
          {fileLabel || (isPdf ? t("pdfDocument") : t("imageReceipt"))}
        </span>
        {!value.startsWith("blob:") && (
          <a href={value} target="_blank" rel="noopener noreferrer" title={t("viewDocument")}>
            <ArrowSquareOutIcon className="size-4 text-muted-foreground hover:text-foreground" />
          </a>
        )}
        <button type="button" onClick={handleRemove} title={t("remove")}>
          <XIcon className="size-4 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    )
  }

  return (
    // Same h-9 / rounded-md as Input. The file input is sr-only rather than `hidden` so it
    // stays reachable with Tab; focus-within draws the ring on the visible drop zone.
    <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <input
        ref={inputRef}
        id={id}
        aria-describedby={describedBy}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={changeEvent => { const pickedFile = changeEvent.target.files?.[0]; if (pickedFile) handleFile(pickedFile) }}
      />
      {uploading
        ? <span className="text-xs">{t("uploading")}</span>
        : <><UploadSimpleIcon className="size-4 shrink-0" /><span>{pdfOnly ? t("attachPdf") : t("attach")}</span></>
      }
    </label>
  )
}
