"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { UploadSimpleIcon, FileIcon, XIcon, ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";

interface DocumentUploadProps {
  value: string
  onChange: (url: string) => void
  prefix?: string
  /** When true, skips the immediate R2 upload. onChange receives a blob: URL for preview,
   *  and onFilePending is called with the File so the consumer can upload at save time —
   *  this avoids leaving an orphaned R2 object when the user picks a file, then removes it
   *  or cancels the form before ever saving (see [[project-devis-facture-fournisseur-modules]]). */
  lazy?: boolean
  onFilePending?: (blobUrl: string, file: File, prefix: string) => void
}

export function DocumentUpload({ value, onChange, prefix = "receipts", lazy = false, onFilePending }: DocumentUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const blobUrlRef = useRef<string | null>(null)

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
    if (file.size > 10 * 1024 * 1024) { toast.error("Fichier trop volumineux (max 10 Mo)"); return }

    if (lazy) {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      const blobUrl = URL.createObjectURL(file)
      blobUrlRef.current = blobUrl
      setPendingFile(file)
      onFilePending?.(blobUrl, file, prefix)
      onChange(blobUrl)
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
        toast.error(body.error ?? "Erreur lors de l'upload")
        return
      }
      const { url } = await res.json()
      onChange(url)
    } catch {
      // fetch itself throwing (offline, DNS failure, timeout) — without this the upload
      // silently resets with no feedback, and the user has no idea it failed.
      toast.error("Erreur réseau lors de l'upload — réessayez")
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
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm">
          {isPdf ? "Document PDF" : "Justificatif image"}
        </span>
        {!value.startsWith("blob:") && (
          <a href={value} target="_blank" rel="noopener noreferrer" title="Voir le document">
            <ArrowSquareOutIcon className="size-4 text-muted-foreground hover:text-foreground" />
          </a>
        )}
        <button type="button" onClick={handleRemove} title="Supprimer">
          <XIcon className="size-4 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    )
  }

  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground transition-colors">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
      {uploading
        ? <span className="text-xs">Upload en cours…</span>
        : <><UploadSimpleIcon className="size-4 shrink-0" /><span>Joindre image ou PDF (max 10 Mo)</span></>
      }
    </label>
  )
}
